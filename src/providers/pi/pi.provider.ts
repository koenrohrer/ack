import * as path from 'path';
import type { FileIOService } from '../../services/fileio.service.js';
import type { SchemaService } from '../../services/schema.service.js';
import type { ConfigService } from '../../services/config.service.js';
import type { BackupService } from '../../services/backup.service.js';
import type { AgentProvider, ProviderCapabilities } from '../../types/provider.js';
import type { CustomPromptInstallResult } from '../../types/provider-install.js';
import type { NormalizedTool } from '../../types/config.js';
import { ToolType, ConfigScope, ToolStatus } from '../../types/enums.js';
import { PiPaths } from './paths.js';
import { parsePiMcpFile } from './parsers/mcp.parser.js';
import { parsePiPromptsDir } from './parsers/prompt.parser.js';
import { parseSkillsDir } from '../claude-code/parsers/skill.parser.js';
import { addMcpServer, removeMcpServer } from '../claude-code/writers/mcp.writer.js';
import { removeSkill, copySkill, renameSkill } from '../claude-code/writers/skill.writer.js';
import { ProviderScopeError } from '../../types/provider-errors.js';

/**
 * Platform provider for Pi.
 *
 * This is the ONLY module that knows about Pi file paths and formats.
 * It reads JSON config files through the parsers and returns NormalizedTool[]
 * arrays. All file paths come exclusively from PiPaths.
 *
 * Pi differs from Claude Code in several ways:
 * - Config lives under ~/.pi/agent/ (user) and .pi/ (project)
 * - MCP servers live in a standalone mcp.json with a top-level `mcpServers`
 *   key (pi-mcp-extension format), not in a settings file
 * - MCP servers have NO per-server disable field -- disable is runtime-only,
 *   so MCP servers and custom prompts are not toggleable
 * - Custom prompts are prompt templates (markdown), not a commands dir
 * - No hook concept exists in Pi
 *
 * MCP write operations delegate to the shared Claude Code mcp.writer JSON
 * functions. Skill write operations delegate to skill.writer.ts shared with
 * Claude Code.
 */
export class PiProvider implements AgentProvider {
  readonly id = 'pi';
  readonly displayName = 'Pi';
  readonly supportedToolTypes: ReadonlySet<ToolType> = new Set([
    ToolType.Skill,
    ToolType.McpServer,
    ToolType.CustomPrompt,
  ]);
  readonly toggleableToolTypes: ReadonlySet<ToolType> = new Set([
    ToolType.Skill,
  ]);
  readonly movableToolTypes: ReadonlySet<ToolType> = new Set([
    ToolType.Skill,
    ToolType.McpServer,
  ]);
  readonly capabilities: ProviderCapabilities = {
    mcpEnvVars: false,
    mcpServerToolToggle: false,
    customPromptFileInstall: true,
  };

  constructor(
    private readonly fileIO: FileIOService,
    private readonly schemaService: SchemaService,
    private readonly workspaceRoot?: string,
    private configService?: ConfigService,
    private backupService?: BackupService,
  ) {}

  /**
   * Inject write-time dependencies after construction.
   * Needed because ConfigService depends on ProviderRegistry, creating
   * a circular init order. Call this once after ConfigService is created.
   */
  setWriteServices(configService: ConfigService, backupService: BackupService): void {
    this.configService = configService;
    this.backupService = backupService;
  }

  // ---------------------------------------------------------------------------
  // ToolCapability -- readTools
  // ---------------------------------------------------------------------------

  /**
   * Read all tools of a given type within a scope.
   *
   * Routes to the correct parser based on type + scope combination.
   * Returns empty array for scopes that require a workspace when none is open.
   *
   * Pi supports Skill, McpServer, and CustomPrompt types. Other types return
   * empty arrays since Pi has no hooks or commands.
   */
  async readTools(type: ToolType, scope: ConfigScope): Promise<NormalizedTool[]> {
    // Scopes that require a workspace
    if (this.requiresWorkspace(scope) && !this.workspaceRoot) {
      return [];
    }

    switch (type) {
      case ToolType.Skill:
        return this.readSkills(scope);
      case ToolType.McpServer:
        return this.readMcpServers(scope);
      case ToolType.CustomPrompt:
        return this.readCustomPrompts(scope);
      default:
        return [];
    }
  }

  // ---------------------------------------------------------------------------
  // ToolCapability -- writeTool
  // ---------------------------------------------------------------------------

  /**
   * Write (create or update) a tool within a scope.
   *
   * For MCP servers: extracts server config from tool metadata and delegates
   * to addMcpServer which writes the entry under the `mcpServers` key.
   */
  async writeTool(tool: NormalizedTool, scope: ConfigScope): Promise<void> {
    this.ensureWriteServices();

    switch (tool.type) {
      case ToolType.McpServer: {
        const { command, args, url, env, transport, lifecycle, headers, tools } = tool.metadata;
        const serverConfig: Record<string, unknown> = {};
        if (command !== undefined) { serverConfig.command = command; }
        if (args !== undefined) { serverConfig.args = args; }
        if (url !== undefined) { serverConfig.url = url; }
        if (env !== undefined && Object.keys(env as Record<string, unknown>).length > 0) { serverConfig.env = env; }
        if (transport !== undefined) { serverConfig.transport = transport; }
        if (lifecycle !== undefined) { serverConfig.lifecycle = lifecycle; }
        if (headers !== undefined) { serverConfig.headers = headers; }
        if (tools !== undefined) { serverConfig.tools = tools; }

        const filePath = this.getMcpFilePath(scope);
        await addMcpServer(this.configService!, filePath, 'pi-mcp-file', tool.name, serverConfig);
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
        throw new Error(`Unsupported tool type for Pi: ${tool.type}`);
    }
  }

  // ---------------------------------------------------------------------------
  // ToolCapability -- removeTool
  // ---------------------------------------------------------------------------

  /**
   * Remove a tool from its scope.
   *
   * For MCP servers: delegates to removeMcpServer which deletes the entry
   * from the `mcpServers` object.
   */
  async removeTool(tool: NormalizedTool): Promise<void> {
    this.ensureWriteServices();

    switch (tool.type) {
      case ToolType.McpServer:
        await removeMcpServer(this.configService!, tool.source.filePath, 'pi-mcp-file', tool.name);
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
        throw new Error(`Unsupported tool type for Pi: ${tool.type}`);
    }
  }

  // ---------------------------------------------------------------------------
  // ToolCapability -- toggleTool
  // ---------------------------------------------------------------------------

  /**
   * Toggle a tool between enabled and disabled states.
   *
   * Only skills can be toggled: Pi MCP servers have no file-level disable
   * field (disable is runtime-only) and custom prompts have no disable
   * semantics. Skills are toggled by renaming SKILL.md (current scheme) or
   * restoring a legacy *.disabled directory.
   */
  async toggleTool(tool: NormalizedTool): Promise<void> {
    this.ensureWriteServices();

    switch (tool.type) {
      case ToolType.Skill: {
        const isDisabling = tool.status === ToolStatus.Enabled;
        const dirPath = tool.source.directoryPath ?? path.dirname(tool.source.filePath);
        // Legacy disable renamed the whole directory; re-enable by restoring it.
        if (!isDisabling && dirPath.endsWith('.disabled')) {
          await renameSkill(dirPath, dirPath.replace(/\.disabled$/, ''));
          break;
        }
        // Current scheme: rename SKILL.md so the agent stops discovering it.
        const targetPath = isDisabling
          ? `${tool.source.filePath}.disabled`
          : tool.source.filePath.replace(/\.disabled$/, '');
        await renameSkill(tool.source.filePath, targetPath);
        break;
      }
      default:
        throw new Error('Pi: only skills can be toggled (MCP servers have no file-level disable field)');
    }
  }

  // ---------------------------------------------------------------------------
  // LifecycleCapability -- detect
  // ---------------------------------------------------------------------------

  /**
   * Detect whether Pi is available on the current system.
   *
   * Detects on any Pi-OWNED marker under ~/.pi/agent/: the agent directory
   * itself, settings.json, or mcp.json.
   */
  async detect(): Promise<boolean> {
    const [dir, settings, mcp] = await Promise.all([
      this.fileIO.fileExists(PiPaths.userPiAgentDir),
      this.fileIO.fileExists(PiPaths.userSettingsJson),
      this.fileIO.fileExists(PiPaths.userMcpJson),
    ]);
    return dir || settings || mcp;
  }

  // ---------------------------------------------------------------------------
  // LifecycleCapability -- getWatchPaths
  // ---------------------------------------------------------------------------

  /**
   * Return filesystem paths that should be watched for changes in a scope.
   *
   * User scope watches settings.json, the skills and prompts directories,
   * and mcp.json. Project scope watches the project mcp.json, skills, and
   * prompts. Other scopes return empty arrays (Pi has no managed/local scopes).
   */
  getWatchPaths(scope: ConfigScope): string[] {
    switch (scope) {
      case ConfigScope.User:
        return [
          PiPaths.userSettingsJson,
          PiPaths.userSkillsDir,
          PiPaths.userPromptsDir,
          PiPaths.userMcpJson,
        ];

      case ConfigScope.Project:
        if (!this.workspaceRoot) {
          return [];
        }
        return [
          PiPaths.projectMcpJson(this.workspaceRoot),
          PiPaths.projectSkillsDir(this.workspaceRoot),
          PiPaths.projectPromptsDir(this.workspaceRoot),
        ];

      default:
        return [];
    }
  }

  // ---------------------------------------------------------------------------
  // McpCapability -- installMcpServer
  // ---------------------------------------------------------------------------

  /**
   * Install an MCP server into the config file for the given scope.
   *
   * Determines the file path from scope and delegates to addMcpServer which
   * writes the entry under the `mcpServers` key.
   */
  async installMcpServer(
    scope: ConfigScope,
    serverName: string,
    serverConfig: Record<string, unknown>,
  ): Promise<void> {
    this.ensureWriteServices();
    const filePath = this.getMcpFilePath(scope);
    await addMcpServer(this.configService!, filePath, 'pi-mcp-file', serverName, serverConfig);
  }

  // ---------------------------------------------------------------------------
  // McpCapability -- getMcpFilePath
  // ---------------------------------------------------------------------------

  /**
   * Return the config file path where MCP servers are defined for the scope.
   *
   * Pi keeps MCP servers in a standalone mcp.json:
   * - User -> ~/.pi/agent/mcp.json
   * - Project -> {root}/.pi/mcp.json
   */
  getMcpFilePath(scope: ConfigScope): string {
    switch (scope) {
      case ConfigScope.User:
        return PiPaths.userMcpJson;
      case ConfigScope.Project:
        if (!this.workspaceRoot) {
          throw new ProviderScopeError('Pi', scope, 'getMcpFilePath (no workspace open)');
        }
        return PiPaths.projectMcpJson(this.workspaceRoot);
      default:
        throw new ProviderScopeError('Pi', scope, 'getMcpFilePath');
    }
  }

  // ---------------------------------------------------------------------------
  // McpCapability -- getMcpSchemaKey
  // ---------------------------------------------------------------------------

  /**
   * Return the schema key used to validate MCP config for the scope.
   *
   * Pi uses the 'pi-mcp-file' schema for all scopes -- the same standalone
   * mcp.json format applies to both user and project scopes.
   */
  getMcpSchemaKey(_scope: ConfigScope): string {
    return 'pi-mcp-file';
  }

  getMcpContainerKey(): string {
    return 'mcpServers';
  }

  getMcpDisableField(): { field: string; disabledValue: unknown } | undefined {
    // Pi MCP (pi-mcp-extension) has no per-server enabled/disabled field;
    // disable is runtime-only, so there is no persisted disable to describe.
    return undefined;
  }

  getMcpConfigFormat(): 'toml' | 'json' | 'yaml' {
    return 'json';
  }

  // ---------------------------------------------------------------------------
  // PathCapability -- getSkillsDir
  // ---------------------------------------------------------------------------

  /**
   * Return the skills directory path for the given scope.
   *
   * - User -> ~/.pi/agent/skills/
   * - Project -> {root}/.pi/skills/
   *
   * Throws ProviderScopeError for other scopes.
   */
  getSkillsDir(scope: ConfigScope): string {
    switch (scope) {
      case ConfigScope.User:
        return PiPaths.userSkillsDir;
      case ConfigScope.Project:
        if (!this.workspaceRoot) {
          throw new ProviderScopeError('Pi', scope, 'getSkillsDir (no workspace open)');
        }
        return PiPaths.projectSkillsDir(this.workspaceRoot);
      default:
        throw new ProviderScopeError('Pi', scope, 'getSkillsDir');
    }
  }

  // ---------------------------------------------------------------------------
  // PathCapability -- getCommandsDir
  // ---------------------------------------------------------------------------

  /**
   * Return the commands directory path for the given scope.
   *
   * **Pi commands are prompt templates, not a commands dir.** Always throws
   * ProviderScopeError.
   */
  getCommandsDir(scope: ConfigScope): string {
    throw new ProviderScopeError('Pi', scope, 'getCommandsDir (Pi commands are prompt templates, not a commands dir)');
  }

  // ---------------------------------------------------------------------------
  // PathCapability -- getSettingsPath
  // ---------------------------------------------------------------------------

  /**
   * Return the settings file path for the given scope.
   *
   * **Pi has no settings-file-managed tools.** Always throws
   * ProviderScopeError -- callers should use getMcpFilePath() instead.
   */
  getSettingsPath(scope: ConfigScope): string {
    throw new ProviderScopeError('Pi', scope, 'getSettingsPath (Pi has no settings-file-managed tools)');
  }

  // ---------------------------------------------------------------------------
  // InstallCapability -- installSkill
  // ---------------------------------------------------------------------------

  /**
   * Install a skill by writing files to the scope's skills directory.
   *
   * Creates the skill subdirectory and writes all provided files.
   * Identical behavior to ClaudeCodeProvider since skill format is shared.
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
  // InstallCapability -- installCommand
  // ---------------------------------------------------------------------------

  /**
   * Install a command.
   *
   * **Pi has no commands.** Always throws ProviderScopeError.
   */
  async installCommand(
    scope: ConfigScope,
    _commandName: string,
    _files: Array<{ name: string; content: string }>,
  ): Promise<void> {
    throw new ProviderScopeError('Pi', scope, 'installCommand (Pi has no commands)');
  }

  // ---------------------------------------------------------------------------
  // InstallCapability -- installHook
  // ---------------------------------------------------------------------------

  /**
   * Install a hook.
   *
   * **Pi has no hooks.** Always throws ProviderScopeError.
   */
  async installHook(
    scope: ConfigScope,
    _eventName: string,
    _matcherGroup: { matcher: string; hooks: unknown[] },
  ): Promise<void> {
    throw new ProviderScopeError('Pi', scope, 'installHook (Pi has no hooks)');
  }

  // ---------------------------------------------------------------------------
  // InstallCapability -- installCustomPromptFile (capabilities.customPromptFileInstall)
  // ---------------------------------------------------------------------------

  /**
   * Install a Pi custom prompt from a local `.md` file into
   * ~/.pi/agent/prompts/<name>.md. Owns Pi's path + validation so the view
   * stays provider-agnostic.
   */
  async installCustomPromptFile(
    sourcePath: string,
    options?: { overwrite?: boolean },
  ): Promise<CustomPromptInstallResult> {
    const filename = path.basename(sourcePath);
    if (!filename.endsWith('.md')) {
      return { status: 'rejected', reason: `Pi prompts must be .md files. Got: '${filename}'` };
    }
    const name = filename.slice(0, -'.md'.length);
    const targetPath = path.join(PiPaths.userPromptsDir, filename);
    if ((await this.fileIO.fileExists(targetPath)) && !options?.overwrite) {
      return { status: 'conflict', name };
    }
    const content = await this.fileIO.readTextFile(sourcePath);
    if (content === null) {
      return { status: 'rejected', reason: `Could not read '${filename}'.` };
    }
    await this.fileIO.writeTextFile(targetPath, content);
    return { status: 'installed', name };
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
   * Read skills from the skills directory for the given scope.
   *
   * Uses the shared skill.parser from Claude Code since the skill format
   * (SKILL.md with YAML frontmatter) is identical between agents.
   */
  private async readSkills(scope: ConfigScope): Promise<NormalizedTool[]> {
    switch (scope) {
      case ConfigScope.User:
        return parseSkillsDir(this.fileIO, this.schemaService, PiPaths.userSkillsDir, ConfigScope.User);
      case ConfigScope.Project:
        if (!this.workspaceRoot) return [];
        return parseSkillsDir(this.fileIO, this.schemaService, PiPaths.projectSkillsDir(this.workspaceRoot), ConfigScope.Project);
      default:
        return [];
    }
  }

  /**
   * Read MCP servers from the mcp.json file for the given scope.
   */
  private async readMcpServers(scope: ConfigScope): Promise<NormalizedTool[]> {
    switch (scope) {
      case ConfigScope.User:
        return parsePiMcpFile(this.fileIO, this.schemaService, PiPaths.userMcpJson, ConfigScope.User);
      case ConfigScope.Project:
        return parsePiMcpFile(this.fileIO, this.schemaService, PiPaths.projectMcpJson(this.workspaceRoot!), ConfigScope.Project);
      default:
        return [];
    }
  }

  /**
   * Read custom prompts from the prompts directory for the given scope.
   */
  private async readCustomPrompts(scope: ConfigScope): Promise<NormalizedTool[]> {
    switch (scope) {
      case ConfigScope.User:
        return parsePiPromptsDir(this.fileIO, PiPaths.userPromptsDir, ConfigScope.User);
      case ConfigScope.Project:
        if (!this.workspaceRoot) return [];
        return parsePiPromptsDir(this.fileIO, PiPaths.projectPromptsDir(this.workspaceRoot), ConfigScope.Project);
      default:
        return [];
    }
  }

  /**
   * Check whether a scope requires a workspace root to be set.
   */
  private requiresWorkspace(scope: ConfigScope): boolean {
    return scope === ConfigScope.Project || scope === ConfigScope.Local;
  }
}
