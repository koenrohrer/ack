import * as path from 'path';
import type { FileIOService } from '../../services/fileio.service.js';
import type { SchemaService } from '../../services/schema.service.js';
import type { ConfigService } from '../../services/config.service.js';
import type { BackupService } from '../../services/backup.service.js';
import type { IPlatformAdapter } from '../../types/adapter.js';
import type { NormalizedTool } from '../../types/config.js';
import { ToolType, ConfigScope, ToolStatus } from '../../types/enums.js';
import { CodexPaths } from './paths.js';
import { parseCodexConfigMcpServers } from './parsers/config.parser.js';
import { parsePromptsDir } from './parsers/prompt.parser.js';
import { parseSkillsDir } from '../claude-code/parsers/skill.parser.js';
import { removeSkill, copySkill, renameSkill } from '../claude-code/writers/skill.writer.js';
import { AdapterScopeError } from '../../types/adapter-errors.js';
import {
  addCodexMcpServer,
  removeCodexMcpServer,
  toggleCodexMcpServer,
} from './writers/config.writer.js';

/**
 * Platform adapter for OpenAI Codex.
 *
 * This is the ONLY module that knows about Codex file paths and formats.
 * It reads TOML config files through the parsers and returns NormalizedTool[]
 * arrays. All file paths come exclusively from CodexPaths.
 *
 * Codex differs from Claude Code in several ways:
 * - Config files are TOML, not JSON
 * - MCP servers are defined inside config.toml, not in separate files
 * - Uses `enabled: false` instead of `disabled: true` for server state
 * - No hook or command concepts exist in Codex
 * - Skills live in ~/.codex/skills/ (similar to Claude Code)
 *
 * MCP write operations delegate to config.writer.ts pure functions.
 * Skill write operations delegate to skill.writer.ts shared with Claude Code.
 */
export class CodexAdapter implements IPlatformAdapter {
  readonly id = 'codex';
  readonly displayName = 'Codex';
  readonly supportedToolTypes: ReadonlySet<ToolType> = new Set([
    ToolType.Skill,
    ToolType.McpServer,
    ToolType.CustomPrompt,
  ]);

  constructor(
    private readonly fileIO: FileIOService,
    private readonly schemaService: SchemaService,
    private readonly workspaceRoot?: string,
    private configService?: ConfigService,
    private backupService?: BackupService,
  ) {}

  /**
   * Inject write-time dependencies after construction.
   * Needed because ConfigService depends on AdapterRegistry, creating
   * a circular init order. Call this once after ConfigService is created.
   */
  setWriteServices(configService: ConfigService, backupService: BackupService): void {
    this.configService = configService;
    this.backupService = backupService;
  }

  // ---------------------------------------------------------------------------
  // IToolAdapter -- readTools
  // ---------------------------------------------------------------------------

  /**
   * Read all tools of a given type within a scope.
   *
   * Routes to the correct parser based on type + scope combination.
   * Returns empty array for scopes that require a workspace when none is open.
   *
   * Codex only supports Skill and McpServer types. Other types return
   * empty arrays since Codex has no hooks or commands.
   */
  async readTools(type: ToolType, scope: ConfigScope): Promise<NormalizedTool[]> {
    // Scopes that require a workspace
    if (this.requiresWorkspace(scope) && !this.workspaceRoot) {
      return [];
    }

    switch (type) {
      case ToolType.McpServer:
        return this.readMcpServers(scope);
      case ToolType.Skill:
        return this.readSkills(scope);
      case ToolType.CustomPrompt:
        return this.readCustomPrompts(scope);
      default:
        return [];
    }
  }

  // ---------------------------------------------------------------------------
  // IToolAdapter -- writeTool
  // ---------------------------------------------------------------------------

  /**
   * Write (create or update) a tool within a scope.
   *
   * For MCP servers: extracts server config from tool metadata and delegates
   * to addCodexMcpServer which writes the [mcp_servers.<name>] TOML table.
   */
  async writeTool(tool: NormalizedTool, scope: ConfigScope): Promise<void> {
    this.ensureWriteServices();

    switch (tool.type) {
      case ToolType.McpServer: {
        const { command, args, url, env, enabled, enabled_tools, disabled_tools, ...rest } = tool.metadata;
        const serverConfig: Record<string, unknown> = { ...rest };
        if (command !== undefined) { serverConfig.command = command; }
        if (args !== undefined) { serverConfig.args = args; }
        if (url !== undefined) { serverConfig.url = url; }
        if (env !== undefined && Object.keys(env as Record<string, unknown>).length > 0) { serverConfig.env = env; }
        if (enabled === false) { serverConfig.enabled = false; }
        if (enabled_tools !== undefined) { serverConfig.enabled_tools = enabled_tools; }
        if (disabled_tools !== undefined) { serverConfig.disabled_tools = disabled_tools; }

        const filePath = this.getMcpFilePath(scope);
        await addCodexMcpServer(this.configService!, filePath, tool.name, serverConfig);
        break;
      }
      case ToolType.Skill: {
        const sourceDir = tool.source.directoryPath ?? path.dirname(tool.source.filePath);
        const targetBaseDir = this.getSkillsDir(scope);
        const targetDir = path.join(targetBaseDir, path.basename(sourceDir));
        await copySkill(sourceDir, targetDir);
        break;
      }
      default:
        throw new Error(`Unsupported tool type for Codex: ${tool.type}`);
    }
  }

  // ---------------------------------------------------------------------------
  // IToolAdapter -- removeTool
  // ---------------------------------------------------------------------------

  /**
   * Remove a tool from its scope.
   *
   * For MCP servers: delegates to removeCodexMcpServer which deletes the
   * [mcp_servers.<name>] table and cleans up empty mcp_servers.
   */
  async removeTool(tool: NormalizedTool): Promise<void> {
    this.ensureWriteServices();

    switch (tool.type) {
      case ToolType.McpServer:
        await removeCodexMcpServer(this.configService!, tool.source.filePath, tool.name);
        break;
      case ToolType.Skill:
        await removeSkill(this.backupService!, tool.source.directoryPath!);
        break;
      case ToolType.CustomPrompt: {
        // Custom prompts are single files - delete directly
        const { rm } = await import('fs/promises');
        await rm(tool.source.filePath);
        break;
      }
      default:
        throw new Error(`Unsupported tool type for Codex: ${tool.type}`);
    }
  }

  // ---------------------------------------------------------------------------
  // IToolAdapter -- toggleTool
  // ---------------------------------------------------------------------------

  /**
   * Toggle a tool between enabled and disabled states.
   *
   * For MCP servers: determines desired state from current status and
   * delegates to toggleCodexMcpServer. Codex uses enabled:false to disable
   * (opposite of Claude Code's disabled:true), so when currently Enabled
   * we pass enabled=false, and when Disabled we pass enabled=true.
   */
  async toggleTool(tool: NormalizedTool): Promise<void> {
    this.ensureWriteServices();

    switch (tool.type) {
      case ToolType.McpServer: {
        // If currently enabled -> we want to disable (enabled=false)
        // If currently disabled -> we want to enable (enabled=true)
        const shouldEnable = tool.status !== ToolStatus.Enabled;
        await toggleCodexMcpServer(this.configService!, tool.source.filePath, tool.name, shouldEnable);
        break;
      }
      case ToolType.Skill: {
        const dirPath = tool.source.directoryPath ?? path.dirname(tool.source.filePath);
        const isDisabling = tool.status === ToolStatus.Enabled;
        const targetPath = isDisabling
          ? `${dirPath}.disabled`
          : dirPath.replace(/\.disabled$/, '');
        await renameSkill(dirPath, targetPath);
        break;
      }
      default:
        throw new Error(`Unsupported tool type for Codex: ${tool.type}`);
    }
  }

  // ---------------------------------------------------------------------------
  // ILifecycleAdapter -- detect
  // ---------------------------------------------------------------------------

  /**
   * Detect whether Codex is available on the current system.
   *
   * Returns true if ~/.codex/ directory exists. This is the primary
   * indicator that Codex has been installed and configured.
   */
  async detect(): Promise<boolean> {
    return this.fileIO.fileExists(CodexPaths.userCodexDir);
  }

  // ---------------------------------------------------------------------------
  // ILifecycleAdapter -- getWatchPaths
  // ---------------------------------------------------------------------------

  /**
   * Return filesystem paths that should be watched for changes in a scope.
   *
   * User scope watches the user config.toml and skills directory.
   * Project scope watches the project config.toml and skills directory.
   * Other scopes return empty arrays (Codex has no managed/local scopes).
   */
  getWatchPaths(scope: ConfigScope): string[] {
    switch (scope) {
      case ConfigScope.User:
        return [
          CodexPaths.userConfigToml,
          CodexPaths.userSkillsDir,
        ];

      case ConfigScope.Project:
        if (!this.workspaceRoot) {
          return [];
        }
        return [
          CodexPaths.projectConfigToml(this.workspaceRoot),
          CodexPaths.projectSkillsDir(this.workspaceRoot),
        ];

      default:
        return [];
    }
  }

  // ---------------------------------------------------------------------------
  // IMcpAdapter -- installMcpServer
  // ---------------------------------------------------------------------------

  /**
   * Install an MCP server into the config file for the given scope.
   *
   * Determines the file path from scope and delegates to addCodexMcpServer
   * which writes the [mcp_servers.<name>] TOML table.
   */
  async installMcpServer(
    scope: ConfigScope,
    serverName: string,
    serverConfig: Record<string, unknown>,
  ): Promise<void> {
    this.ensureWriteServices();
    const filePath = this.getMcpFilePath(scope);
    await addCodexMcpServer(this.configService!, filePath, serverName, serverConfig);
  }

  // ---------------------------------------------------------------------------
  // IMcpAdapter -- getMcpFilePath
  // ---------------------------------------------------------------------------

  /**
   * Return the config file path where MCP servers are defined for the scope.
   *
   * For Codex, MCP servers are embedded in config.toml (not a separate file):
   * - User -> ~/.codex/config.toml
   * - Project -> {root}/.codex/config.toml
   */
  getMcpFilePath(scope: ConfigScope): string {
    switch (scope) {
      case ConfigScope.User:
        return CodexPaths.userConfigToml;
      case ConfigScope.Project:
        if (!this.workspaceRoot) {
          throw new AdapterScopeError('Codex', scope, 'getMcpFilePath (no workspace open)');
        }
        return CodexPaths.projectConfigToml(this.workspaceRoot);
      default:
        throw new AdapterScopeError('Codex', scope, 'getMcpFilePath');
    }
  }

  // ---------------------------------------------------------------------------
  // IMcpAdapter -- getMcpSchemaKey
  // ---------------------------------------------------------------------------

  /**
   * Return the schema key used to validate MCP config for the scope.
   *
   * Codex uses the 'codex-config' schema for all scopes because MCP servers
   * are embedded in the config.toml file, not in a separate MCP config file.
   */
  getMcpSchemaKey(_scope: ConfigScope): string {
    return 'codex-config';
  }

  // ---------------------------------------------------------------------------
  // IPathAdapter -- getSkillsDir
  // ---------------------------------------------------------------------------

  /**
   * Return the skills directory path for the given scope.
   *
   * - User -> ~/.codex/skills/
   * - Project -> {root}/.codex/skills/
   *
   * Throws AdapterScopeError for other scopes.
   */
  getSkillsDir(scope: ConfigScope): string {
    switch (scope) {
      case ConfigScope.User:
        return CodexPaths.userSkillsDir;
      case ConfigScope.Project:
        if (!this.workspaceRoot) {
          throw new AdapterScopeError('Codex', scope, 'getSkillsDir (no workspace open)');
        }
        return CodexPaths.projectSkillsDir(this.workspaceRoot);
      default:
        throw new AdapterScopeError('Codex', scope, 'getSkillsDir');
    }
  }

  // ---------------------------------------------------------------------------
  // IPathAdapter -- getCommandsDir
  // ---------------------------------------------------------------------------

  /**
   * Return the commands directory path for the given scope.
   *
   * **Codex does not support commands.** Always throws AdapterScopeError.
   */
  getCommandsDir(scope: ConfigScope): string {
    throw new AdapterScopeError('Codex', scope, 'getCommandsDir (Codex does not support commands)');
  }

  // ---------------------------------------------------------------------------
  // IPathAdapter -- getSettingsPath
  // ---------------------------------------------------------------------------

  /**
   * Return the settings file path for the given scope.
   *
   * **Codex uses config.toml, not settings.json.** Always throws
   * AdapterScopeError -- callers should use getMcpFilePath() instead.
   */
  getSettingsPath(scope: ConfigScope): string {
    throw new AdapterScopeError('Codex', scope, 'getSettingsPath (Codex uses config.toml, not settings.json)');
  }

  // ---------------------------------------------------------------------------
  // IInstallAdapter -- installSkill
  // ---------------------------------------------------------------------------

  /**
   * Install a skill by writing files to the scope's skills directory.
   *
   * Creates the skill subdirectory and writes all provided files.
   * Identical behavior to ClaudeCodeAdapter since skill format is shared.
   */
  async installSkill(
    scope: ConfigScope,
    skillName: string,
    files: Array<{ name: string; content: string }>,
  ): Promise<void> {
    const { mkdir, writeFile } = await import('fs/promises');
    const baseDir = this.getSkillsDir(scope);
    const targetDir = path.join(baseDir, skillName);
    await mkdir(targetDir, { recursive: true });
    for (const file of files) {
      await writeFile(path.join(targetDir, file.name), file.content, 'utf-8');
    }
  }

  // ---------------------------------------------------------------------------
  // IInstallAdapter -- installCommand
  // ---------------------------------------------------------------------------

  /**
   * Install a command.
   *
   * **Codex does not support commands.** Always throws AdapterScopeError.
   */
  async installCommand(
    scope: ConfigScope,
    _commandName: string,
    _files: Array<{ name: string; content: string }>,
  ): Promise<void> {
    throw new AdapterScopeError('Codex', scope, 'installCommand (Codex does not support commands)');
  }

  // ---------------------------------------------------------------------------
  // IInstallAdapter -- installHook
  // ---------------------------------------------------------------------------

  /**
   * Install a hook.
   *
   * **Codex does not support hooks.** Always throws AdapterScopeError.
   */
  async installHook(
    scope: ConfigScope,
    _eventName: string,
    _matcherGroup: { matcher: string; hooks: unknown[] },
  ): Promise<void> {
    throw new AdapterScopeError('Codex', scope, 'installHook (Codex does not support hooks)');
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  /**
   * Guard that write-time services have been injected.
   * Throws if ConfigService or BackupService are missing.
   */
  private ensureWriteServices(): void {
    if (!this.configService || !this.backupService) {
      throw new Error('Write services not initialized. Call setWriteServices() first.');
    }
  }

  /**
   * Read MCP servers from the config.toml file for the given scope.
   */
  private async readMcpServers(scope: ConfigScope): Promise<NormalizedTool[]> {
    switch (scope) {
      case ConfigScope.User:
        return parseCodexConfigMcpServers(
          this.fileIO,
          this.schemaService,
          CodexPaths.userConfigToml,
          ConfigScope.User,
        );
      case ConfigScope.Project:
        return parseCodexConfigMcpServers(
          this.fileIO,
          this.schemaService,
          CodexPaths.projectConfigToml(this.workspaceRoot!),
          ConfigScope.Project,
        );
      default:
        return [];
    }
  }

  /**
   * Read skills from the skills directory for the given scope.
   *
   * Uses the shared skill.parser from Claude Code since the skill format
   * (SKILL.md with YAML frontmatter) is identical between agents.
   */
  private async readSkills(scope: ConfigScope): Promise<NormalizedTool[]> {
    switch (scope) {
      case ConfigScope.User:
        return parseSkillsDir(this.fileIO, this.schemaService, CodexPaths.userSkillsDir, ConfigScope.User);
      case ConfigScope.Project:
        if (!this.workspaceRoot) return [];
        return parseSkillsDir(this.fileIO, this.schemaService, CodexPaths.projectSkillsDir(this.workspaceRoot), ConfigScope.Project);
      default:
        return [];
    }
  }

  /**
   * Read custom prompts from the prompts directory for the given scope.
   *
   * User scope only per CONTEXT.md -- project scope returns empty array.
   */
  private async readCustomPrompts(scope: ConfigScope): Promise<NormalizedTool[]> {
    if (scope !== ConfigScope.User) {
      return []; // User scope only per CONTEXT.md
    }
    return parsePromptsDir(this.fileIO, CodexPaths.userPromptsDir, ConfigScope.User);
  }

  /**
   * Check whether a scope requires a workspace root to be set.
   */
  private requiresWorkspace(scope: ConfigScope): boolean {
    return scope === ConfigScope.Project || scope === ConfigScope.Local;
  }
}
