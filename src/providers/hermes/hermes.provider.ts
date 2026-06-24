import * as path from 'path';
import type { FileIOService } from '../../services/fileio.service.js';
import type { SchemaService } from '../../services/schema.service.js';
import type { ConfigService } from '../../services/config.service.js';
import type { BackupService } from '../../services/backup.service.js';
import type { AgentProvider, ProviderCapabilities } from '../../types/provider.js';
import type { NormalizedTool } from '../../types/config.js';
import { ToolType, ConfigScope, ToolStatus } from '../../types/enums.js';
import { HermesPaths } from './paths.js';
import { parseHermesConfigMcpServers } from './parsers/config.parser.js';
import { parseHermesSoul } from './parsers/soul.parser.js';
import { parseSkillsDir } from '../claude-code/parsers/skill.parser.js';
import { removeSkill, copySkill, renameSkill } from '../claude-code/writers/skill.writer.js';
import { ProviderScopeError } from '../../types/provider-errors.js';
import {
  addHermesMcpServer,
  removeHermesMcpServer,
  toggleHermesMcpServer,
  setEnvVar,
  removeEnvVar,
} from './writers/config.writer.js';

/**
 * Platform provider for NousResearch Hermes.
 *
 * This is the ONLY module that knows about Hermes file paths and formats.
 * It reads YAML config files through the parsers and returns NormalizedTool[]
 * arrays. All file paths come exclusively from HermesPaths.
 *
 * Hermes differs from Claude Code in several ways:
 * - Config files are YAML, not JSON
 * - MCP servers are defined inside config.yaml, not in separate files
 * - Uses `enabled: false` instead of `disabled: true` for server state
 * - Has user + read-only managed scopes, but no project scope
 * - Custom prompts are a single durable SOUL.md, not a prompts directory
 *
 * MCP write operations delegate to config.writer.ts pure functions.
 * Skill write operations delegate to skill.writer.ts shared with Claude Code.
 */
export class HermesProvider implements AgentProvider {
  readonly id = 'hermes';
  readonly displayName = 'Hermes';
  readonly supportedToolTypes: ReadonlySet<ToolType> = new Set([
    ToolType.McpServer,
    ToolType.Skill,
    ToolType.CustomPrompt,
  ]);
  readonly toggleableToolTypes: ReadonlySet<ToolType> = new Set([
    ToolType.McpServer,
    ToolType.Skill,
  ]);
  // Hermes has no project scope; nothing moves between scopes.
  readonly movableToolTypes: ReadonlySet<ToolType> = new Set();
  readonly capabilities: ProviderCapabilities = {
    mcpEnvVars: true,
    mcpServerToolToggle: false,
    customPromptFileInstall: false,
  };

  constructor(
    private readonly fileIO: FileIOService,
    private readonly schemaService: SchemaService,
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
   * Skills and the SOUL.md custom prompt only exist in user scope; the
   * managed scope is config.yaml only (MCP servers, read-only).
   */
  async readTools(type: ToolType, scope: ConfigScope): Promise<NormalizedTool[]> {
    switch (type) {
      case ToolType.McpServer:
        return this.readMcpServers(scope);
      case ToolType.Skill:
        return scope === ConfigScope.User
          ? parseSkillsDir(this.fileIO, this.schemaService, HermesPaths.userSkillsDir, ConfigScope.User)
          : [];
      case ToolType.CustomPrompt:
        return scope === ConfigScope.User
          ? parseHermesSoul(this.fileIO, HermesPaths.userSoulMd, ConfigScope.User)
          : [];
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
   * to addHermesMcpServer which writes the `mcp_servers.<name>` YAML entry.
   * The managed scope is read-only -- writes to it throw.
   */
  async writeTool(tool: NormalizedTool, scope: ConfigScope): Promise<void> {
    this.ensureWriteServices();

    if (scope === ConfigScope.Managed) {
      throw new Error('Cannot write to Hermes managed scope (read-only)');
    }

    switch (tool.type) {
      case ToolType.McpServer: {
        const { command, args, url, env, headers, auth, oauth, transport, tools, enabled, ...rest } = tool.metadata;
        const serverConfig: Record<string, unknown> = { ...rest };
        if (command !== undefined) { serverConfig.command = command; }
        if (args !== undefined) { serverConfig.args = args; }
        if (url !== undefined) { serverConfig.url = url; }
        if (env !== undefined && Object.keys(env as Record<string, unknown>).length > 0) { serverConfig.env = env; }
        if (headers !== undefined) { serverConfig.headers = headers; }
        if (auth !== undefined) { serverConfig.auth = auth; }
        if (oauth !== undefined) { serverConfig.oauth = oauth; }
        if (transport !== undefined) { serverConfig.transport = transport; }
        if (tools !== undefined) { serverConfig.tools = tools; }
        if (enabled === false) { serverConfig.enabled = false; }

        const filePath = this.getMcpFilePath(scope);
        await addHermesMcpServer(this.configService!, filePath, tool.name, serverConfig);
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
        throw new Error(`Unsupported tool type for Hermes: ${tool.type}`);
    }
  }

  // ---------------------------------------------------------------------------
  // ToolCapability -- removeTool
  // ---------------------------------------------------------------------------

  /**
   * Remove a tool from its scope.
   *
   * For MCP servers: delegates to removeHermesMcpServer which deletes the
   * `mcp_servers.<name>` entry and cleans up an empty mcp_servers map.
   * The managed scope is read-only -- removals from it throw.
   */
  async removeTool(tool: NormalizedTool): Promise<void> {
    this.ensureWriteServices();

    if (tool.scope === ConfigScope.Managed) {
      throw new Error('Cannot remove from Hermes managed scope (read-only)');
    }

    switch (tool.type) {
      case ToolType.McpServer:
        await removeHermesMcpServer(this.configService!, tool.source.filePath, tool.name);
        break;
      case ToolType.Skill:
        await removeSkill(this.backupService!, tool.source.directoryPath!);
        break;
      case ToolType.CustomPrompt: {
        // SOUL.md is a single file - delete directly
        const { rm } = await import('fs/promises');
        await rm(tool.source.filePath);
        break;
      }
      default:
        throw new Error(`Unsupported tool type for Hermes: ${tool.type}`);
    }
  }

  // ---------------------------------------------------------------------------
  // ToolCapability -- toggleTool
  // ---------------------------------------------------------------------------

  /**
   * Toggle a tool between enabled and disabled states.
   *
   * For MCP servers: determines desired state from current status and
   * delegates to toggleHermesMcpServer. Hermes uses enabled:false to disable
   * (opposite of Claude Code's disabled:true), so when currently Enabled
   * we pass enabled=false, and when Disabled we pass enabled=true.
   * The managed scope is read-only -- toggles in it throw.
   */
  async toggleTool(tool: NormalizedTool): Promise<void> {
    this.ensureWriteServices();

    if (tool.scope === ConfigScope.Managed) {
      throw new Error('Cannot toggle in Hermes managed scope (read-only)');
    }

    switch (tool.type) {
      case ToolType.McpServer: {
        // If currently enabled -> we want to disable (enabled=false)
        // If currently disabled -> we want to enable (enabled=true)
        const shouldEnable = tool.status !== ToolStatus.Enabled;
        await toggleHermesMcpServer(this.configService!, tool.source.filePath, tool.name, shouldEnable);
        break;
      }
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
        throw new Error(`Unsupported tool type for Hermes: ${tool.type}`);
    }
  }

  // ---------------------------------------------------------------------------
  // LifecycleCapability -- detect
  // ---------------------------------------------------------------------------

  /**
   * Detect whether Hermes is available on the current system.
   *
   * Presence of the user dir or its config.yaml is sufficient -- either marks
   * a Hermes install.
   */
  async detect(): Promise<boolean> {
    const [dir, cfg] = await Promise.all([
      this.fileIO.fileExists(HermesPaths.userHermesDir),
      this.fileIO.fileExists(HermesPaths.userConfigYaml),
    ]);
    return dir || cfg;
  }

  // ---------------------------------------------------------------------------
  // LifecycleCapability -- getWatchPaths
  // ---------------------------------------------------------------------------

  /**
   * Return filesystem paths that should be watched for changes in a scope.
   *
   * User scope watches config.yaml, the skills directory, and SOUL.md.
   * Managed scope watches the read-only managed config.yaml.
   * Other scopes return empty arrays (Hermes has no project/local scopes).
   */
  getWatchPaths(scope: ConfigScope): string[] {
    switch (scope) {
      case ConfigScope.User:
        return [
          HermesPaths.userConfigYaml,
          HermesPaths.userSkillsDir,
          HermesPaths.userSoulMd,
        ];
      case ConfigScope.Managed:
        return [HermesPaths.managedConfigYaml];
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
   * Determines the file path from scope and delegates to addHermesMcpServer
   * which writes the `mcp_servers.<name>` YAML entry. The managed scope is
   * read-only -- installs into it throw.
   */
  async installMcpServer(
    scope: ConfigScope,
    serverName: string,
    serverConfig: Record<string, unknown>,
  ): Promise<void> {
    this.ensureWriteServices();
    if (scope === ConfigScope.Managed) {
      throw new Error('Cannot install into Hermes managed scope (read-only)');
    }
    const filePath = this.getMcpFilePath(scope);
    await addHermesMcpServer(this.configService!, filePath, serverName, serverConfig);
  }

  // ---------------------------------------------------------------------------
  // McpCapability -- getMcpFilePath
  // ---------------------------------------------------------------------------

  /**
   * Return the config file path where MCP servers are defined for the scope.
   *
   * For Hermes, MCP servers are embedded in config.yaml (not a separate file):
   * - User -> ~/.hermes/config.yaml
   * - Managed -> {managedDir}/config.yaml
   */
  getMcpFilePath(scope: ConfigScope): string {
    switch (scope) {
      case ConfigScope.User:
        return HermesPaths.userConfigYaml;
      case ConfigScope.Managed:
        return HermesPaths.managedConfigYaml;
      default:
        throw new ProviderScopeError('Hermes', scope, 'getMcpFilePath');
    }
  }

  // ---------------------------------------------------------------------------
  // McpCapability -- getMcpSchemaKey
  // ---------------------------------------------------------------------------

  /**
   * Return the schema key used to validate MCP config for the scope.
   *
   * Hermes uses the 'hermes-config' schema for all scopes because MCP servers
   * are embedded in the config.yaml file, not in a separate MCP config file.
   */
  getMcpSchemaKey(_scope: ConfigScope): string {
    return 'hermes-config';
  }

  getMcpContainerKey(): string {
    return 'mcp_servers';
  }

  getMcpDisableField(): { field: string; disabledValue: unknown } {
    return { field: 'enabled', disabledValue: false };
  }

  getMcpConfigFormat(): 'toml' | 'json' | 'yaml' {
    return 'yaml';
  }

  // ---------------------------------------------------------------------------
  // McpCapability -- optional capability methods (capabilities.mcpEnvVars).
  // Delegate to the config.writer YAML mutations so the view never touches
  // Hermes's file format.
  // ---------------------------------------------------------------------------

  async setMcpEnvVar(server: NormalizedTool, key: string, value: string): Promise<void> {
    this.ensureWriteServices();
    await setEnvVar(this.configService!, server.source.filePath, server.name, key, value);
  }

  async removeMcpEnvVar(server: NormalizedTool, key: string): Promise<void> {
    this.ensureWriteServices();
    await removeEnvVar(this.configService!, server.source.filePath, server.name, key);
  }

  // ---------------------------------------------------------------------------
  // PathCapability -- getSkillsDir
  // ---------------------------------------------------------------------------

  /**
   * Return the skills directory path for the given scope.
   *
   * - User -> ~/.hermes/skills/
   *
   * Throws ProviderScopeError for other scopes (Hermes skills are user-only).
   */
  getSkillsDir(scope: ConfigScope): string {
    switch (scope) {
      case ConfigScope.User:
        return HermesPaths.userSkillsDir;
      default:
        throw new ProviderScopeError('Hermes', scope, 'getSkillsDir');
    }
  }

  // ---------------------------------------------------------------------------
  // PathCapability -- getCommandsDir
  // ---------------------------------------------------------------------------

  /**
   * Return the commands directory path for the given scope.
   *
   * **Hermes has no file-based commands** -- quick_commands live in config.yaml.
   * Always throws ProviderScopeError.
   */
  getCommandsDir(scope: ConfigScope): string {
    throw new ProviderScopeError('Hermes', scope, 'getCommandsDir (Hermes quick_commands live in config.yaml, not a commands dir)');
  }

  // ---------------------------------------------------------------------------
  // PathCapability -- getSettingsPath
  // ---------------------------------------------------------------------------

  /**
   * Return the settings file path for the given scope.
   *
   * **Hermes uses config.yaml, not settings.json.** Always throws
   * ProviderScopeError -- callers should use getMcpFilePath() instead.
   */
  getSettingsPath(scope: ConfigScope): string {
    throw new ProviderScopeError('Hermes', scope, 'getSettingsPath (Hermes uses config.yaml; hooks are not yet managed by ACK)');
  }

  // ---------------------------------------------------------------------------
  // InstallCapability -- installSkill
  // ---------------------------------------------------------------------------

  /**
   * Install a skill by writing files to the scope's skills directory.
   *
   * Creates the skill subdirectory and writes all provided files.
   * getSkillsDir(scope) throws for non-user scopes, which is correct since
   * Hermes skills are user-only.
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
   * **Hermes has no file-based commands.** Always throws ProviderScopeError.
   */
  async installCommand(
    scope: ConfigScope,
    _commandName: string,
    _files: Array<{ name: string; content: string }>,
  ): Promise<void> {
    throw new ProviderScopeError('Hermes', scope, 'installCommand (Hermes has no file-based commands)');
  }

  // ---------------------------------------------------------------------------
  // InstallCapability -- installHook
  // ---------------------------------------------------------------------------

  /**
   * Install a hook.
   *
   * **Hermes hooks are not yet managed by ACK.** Always throws ProviderScopeError.
   */
  async installHook(
    scope: ConfigScope,
    _eventName: string,
    _matcherGroup: { matcher: string; hooks: unknown[] },
  ): Promise<void> {
    throw new ProviderScopeError('Hermes', scope, 'installHook (Hermes hooks are not yet managed by ACK)');
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
   * Read MCP servers from the config.yaml file for the given scope.
   */
  private async readMcpServers(scope: ConfigScope): Promise<NormalizedTool[]> {
    switch (scope) {
      case ConfigScope.User:
        return parseHermesConfigMcpServers(
          this.fileIO,
          this.schemaService,
          HermesPaths.userConfigYaml,
          ConfigScope.User,
        );
      case ConfigScope.Managed:
        return parseHermesConfigMcpServers(
          this.fileIO,
          this.schemaService,
          HermesPaths.managedConfigYaml,
          ConfigScope.Managed,
        );
      default:
        return [];
    }
  }
}
