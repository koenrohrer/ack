import type { FileIOService } from '../../services/fileio.service.js';
import type { SchemaService } from '../../services/schema.service.js';
import type { ConfigService } from '../../services/config.service.js';
import type { BackupService } from '../../services/backup.service.js';
import type { IPlatformAdapter } from '../../types/adapter.js';
import type { NormalizedTool } from '../../types/config.js';
import { ToolType, ConfigScope } from '../../types/enums.js';
import { CodexPaths } from './paths.js';
import { parseCodexConfigMcpServers } from './parsers/config.parser.js';
import { AdapterScopeError } from '../../types/adapter-errors.js';

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
 * Write operations (toggle, remove, install) are stubbed to throw
 * "not yet implemented" errors. Full write support is Phase 15+ scope.
 */
export class CodexAdapter implements IPlatformAdapter {
  readonly id = 'codex';
  readonly displayName = 'Codex';
  readonly supportedToolTypes: ReadonlySet<ToolType> = new Set([
    ToolType.Skill,
    ToolType.McpServer,
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
        // Skill parsing is Phase 16 scope -- return empty for now
        return [];
      default:
        return [];
    }
  }

  // ---------------------------------------------------------------------------
  // IToolAdapter -- writeTool (stub)
  // ---------------------------------------------------------------------------

  /**
   * Write (create or update) a tool within a scope.
   *
   * **Not yet implemented.** Full write support requires the Codex writer
   * infrastructure from Phase 15+. Throws immediately to signal the stub.
   */
  async writeTool(_tool: NormalizedTool, _scope: ConfigScope): Promise<void> {
    throw new Error('Codex writeTool not yet implemented');
  }

  // ---------------------------------------------------------------------------
  // IToolAdapter -- removeTool (stub)
  // ---------------------------------------------------------------------------

  /**
   * Remove a tool from its scope.
   *
   * **Not yet implemented.** Full write support requires the Codex writer
   * infrastructure from Phase 15+. Throws immediately to signal the stub.
   */
  async removeTool(_tool: NormalizedTool): Promise<void> {
    throw new Error('Codex removeTool not yet implemented');
  }

  // ---------------------------------------------------------------------------
  // IToolAdapter -- toggleTool (stub)
  // ---------------------------------------------------------------------------

  /**
   * Toggle a tool between enabled and disabled states.
   *
   * **Not yet implemented.** Full write support requires the Codex writer
   * infrastructure from Phase 15+. Throws immediately to signal the stub.
   */
  async toggleTool(_tool: NormalizedTool): Promise<void> {
    throw new Error('Codex toggleTool not yet implemented');
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
  // IMcpAdapter -- installMcpServer (stub)
  // ---------------------------------------------------------------------------

  /**
   * Install an MCP server into the config file for the given scope.
   *
   * **Not yet implemented.** Requires TOML write infrastructure from Phase 15.
   * Throws immediately to signal the stub.
   */
  async installMcpServer(
    _scope: ConfigScope,
    _serverName: string,
    _serverConfig: Record<string, unknown>,
  ): Promise<void> {
    throw new Error('Codex installMcpServer not yet implemented');
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
  // IInstallAdapter -- installSkill (stub)
  // ---------------------------------------------------------------------------

  /**
   * Install a skill by writing files to the scope's skills directory.
   *
   * **Not yet implemented.** Skill installation is Phase 16 scope.
   * Throws immediately to signal the stub.
   */
  async installSkill(
    _scope: ConfigScope,
    _skillName: string,
    _files: Array<{ name: string; content: string }>,
  ): Promise<void> {
    throw new Error('Codex installSkill not yet implemented');
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
   * Check whether a scope requires a workspace root to be set.
   */
  private requiresWorkspace(scope: ConfigScope): boolean {
    return scope === ConfigScope.Project || scope === ConfigScope.Local;
  }
}
