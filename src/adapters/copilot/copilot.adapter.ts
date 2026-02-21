import * as vscode from 'vscode';
import * as path from 'path';
import type { FileIOService } from '../../services/fileio.service.js';
import type { SchemaService } from '../../services/schema.service.js';
import type { ConfigService } from '../../services/config.service.js';
import type { BackupService } from '../../services/backup.service.js';
import type { IPlatformAdapter } from '../../types/adapter.js';
import type { NormalizedTool } from '../../types/config.js';
import { ToolType, ConfigScope } from '../../types/enums.js';
import { AdapterScopeError } from '../../types/adapter-errors.js';
import { CopilotPaths } from './paths.js';

/**
 * Platform adapter for GitHub Copilot.
 *
 * This is the ONLY module that knows about Copilot file paths and formats.
 * It returns NormalizedTool[] arrays from all read methods and routes path
 * resolution through CopilotPaths. All file paths come exclusively from
 * CopilotPaths.
 *
 * **Phase 20 — Scaffold only:**
 * All read methods return empty arrays. All write/remove/toggle/install
 * methods throw descriptive errors. Phase 21+ implements full read/write
 * support.
 *
 * Copilot differs from Claude Code and Codex in several ways:
 * - Detection uses vscode.extensions.getExtension (not filesystem)
 * - User-scope MCP is at {vsCodeUserDir}/mcp.json (not ~/.claude.json)
 * - Workspace MCP is at .vscode/mcp.json (not .mcp.json)
 * - MCP schema uses a `servers` key (not `mcpServers`)
 * - Custom prompts live in .github/prompts/
 * - Skills/agents live in .github/agents/
 */
export class CopilotAdapter implements IPlatformAdapter {
  readonly id = 'copilot';
  readonly displayName = 'GitHub Copilot';
  readonly supportedToolTypes: ReadonlySet<ToolType> = new Set([
    ToolType.McpServer,
    ToolType.CustomPrompt,
    ToolType.Skill,
  ]);

  /**
   * VS Code user directory derived from context.globalStorageUri at construction.
   *
   * context.globalStorageUri.fsPath = .../Code/User/globalStorage/publisher.ext/
   * path.dirname once  = .../Code/User/globalStorage/
   * path.dirname twice = .../Code/User/   <-- stored here
   */
  private readonly vsCodeUserDir: string;

  constructor(
    private readonly fileIO: FileIOService,
    private readonly schemaService: SchemaService,
    private readonly workspaceRoot: string | undefined,
    context: vscode.ExtensionContext,
    private configService?: ConfigService,
    private backupService?: BackupService,
  ) {
    this.vsCodeUserDir = path.dirname(
      path.dirname(context.globalStorageUri.fsPath),
    );
  }

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
  // ILifecycleAdapter -- detect
  // ---------------------------------------------------------------------------

  /**
   * Detect whether GitHub Copilot is available in the current VS Code instance.
   *
   * Uses the VS Code Extension API — no filesystem check. This is called
   * each time the QuickPick opens so it stays current without caching.
   */
  async detect(): Promise<boolean> {
    return vscode.extensions.getExtension('GitHub.copilot') !== undefined;
  }

  // ---------------------------------------------------------------------------
  // ILifecycleAdapter -- getWatchPaths
  // ---------------------------------------------------------------------------

  /**
   * Return filesystem paths that should be watched for changes in a scope.
   *
   * Returns empty array in Phase 20 — Phase 21+ will populate watch paths
   * for user mcp.json and workspace .vscode/mcp.json.
   */
  getWatchPaths(_scope: ConfigScope): string[] {
    return [];
  }

  // ---------------------------------------------------------------------------
  // IToolAdapter -- readTools
  // ---------------------------------------------------------------------------

  /**
   * Read all tools of a given type within a scope.
   *
   * **Phase 20 scaffold:** Returns empty array for all types and scopes.
   * Phase 21+ implements actual reads from Copilot config files.
   */
  async readTools(_type: ToolType, _scope: ConfigScope): Promise<NormalizedTool[]> {
    return Promise.resolve([]);
  }

  // ---------------------------------------------------------------------------
  // IToolAdapter -- writeTool
  // ---------------------------------------------------------------------------

  /**
   * Write (create or update) a tool within a scope.
   *
   * **Phase 20 scaffold:** Not yet implemented.
   */
  async writeTool(_tool: NormalizedTool, _scope: ConfigScope): Promise<void> {
    throw new Error('CopilotAdapter: write operations not yet implemented (Phase 21+)');
  }

  // ---------------------------------------------------------------------------
  // IToolAdapter -- removeTool
  // ---------------------------------------------------------------------------

  /**
   * Remove a tool from its scope.
   *
   * **Phase 20 scaffold:** Not yet implemented.
   */
  async removeTool(_tool: NormalizedTool): Promise<void> {
    throw new Error('CopilotAdapter: remove operations not yet implemented (Phase 21+)');
  }

  // ---------------------------------------------------------------------------
  // IToolAdapter -- toggleTool
  // ---------------------------------------------------------------------------

  /**
   * Toggle a tool between enabled and disabled states.
   *
   * **Phase 20 scaffold:** Not yet implemented.
   */
  async toggleTool(_tool: NormalizedTool): Promise<void> {
    throw new Error('CopilotAdapter: toggle operations not yet implemented (Phase 21+)');
  }

  // ---------------------------------------------------------------------------
  // IMcpAdapter -- installMcpServer
  // ---------------------------------------------------------------------------

  /**
   * Install an MCP server into the config file for the given scope.
   *
   * **Phase 20 scaffold:** Not yet implemented.
   */
  async installMcpServer(
    _scope: ConfigScope,
    _serverName: string,
    _serverConfig: Record<string, unknown>,
  ): Promise<void> {
    throw new Error('CopilotAdapter: installMcpServer not yet implemented (Phase 21+)');
  }

  // ---------------------------------------------------------------------------
  // IMcpAdapter -- getMcpFilePath
  // ---------------------------------------------------------------------------

  /**
   * Return the config file path where MCP servers are defined for the scope.
   *
   * For Copilot:
   * - User -> {vsCodeUserDir}/mcp.json
   * - Project -> {root}/.vscode/mcp.json
   */
  getMcpFilePath(scope: ConfigScope): string {
    switch (scope) {
      case ConfigScope.User:
        return CopilotPaths.userMcpJson(this.vsCodeUserDir);
      case ConfigScope.Project:
        if (!this.workspaceRoot) {
          throw new AdapterScopeError('GitHub Copilot', scope, 'getMcpFilePath (no workspace open)');
        }
        return CopilotPaths.workspaceMcpJson(this.workspaceRoot);
      default:
        throw new AdapterScopeError('GitHub Copilot', scope, 'getMcpFilePath');
    }
  }

  // ---------------------------------------------------------------------------
  // IMcpAdapter -- getMcpSchemaKey
  // ---------------------------------------------------------------------------

  /**
   * Return the schema key used to validate MCP config for the scope.
   *
   * Copilot uses the 'copilot-mcp' schema for all scopes.
   * Schema is registered in Phase 21.
   */
  getMcpSchemaKey(_scope: ConfigScope): string {
    return 'copilot-mcp';
  }

  // ---------------------------------------------------------------------------
  // IPathAdapter -- getSkillsDir
  // ---------------------------------------------------------------------------

  /**
   * Return the skills directory path for the given scope.
   *
   * **Phase 20 scaffold:** Copilot agent/skills support is implemented in Phase 23+.
   */
  getSkillsDir(scope: ConfigScope): string {
    throw new AdapterScopeError('GitHub Copilot', scope, 'getSkillsDir (Phase 23+)');
  }

  // ---------------------------------------------------------------------------
  // IPathAdapter -- getCommandsDir
  // ---------------------------------------------------------------------------

  /**
   * Return the commands directory path for the given scope.
   *
   * Copilot has no slash commands concept — always throws.
   */
  getCommandsDir(scope: ConfigScope): string {
    throw new AdapterScopeError('GitHub Copilot', scope, 'getCommandsDir (Copilot has no slash commands)');
  }

  // ---------------------------------------------------------------------------
  // IPathAdapter -- getSettingsPath
  // ---------------------------------------------------------------------------

  /**
   * Return the settings file path for the given scope.
   *
   * Copilot uses VS Code settings (settings.json) — not a separate agent settings file.
   */
  getSettingsPath(scope: ConfigScope): string {
    throw new AdapterScopeError('GitHub Copilot', scope, 'getSettingsPath (Copilot uses VS Code settings)');
  }

  // ---------------------------------------------------------------------------
  // IInstallAdapter -- installSkill
  // ---------------------------------------------------------------------------

  /**
   * Install a skill by writing files to the scope's skills directory.
   *
   * **Phase 20 scaffold:** Not yet implemented.
   */
  async installSkill(
    scope: ConfigScope,
    _skillName: string,
    _files: Array<{ name: string; content: string }>,
  ): Promise<void> {
    throw new AdapterScopeError('GitHub Copilot', scope, 'installSkill (Phase 23+)');
  }

  // ---------------------------------------------------------------------------
  // IInstallAdapter -- installCommand
  // ---------------------------------------------------------------------------

  /**
   * Install a command.
   *
   * **Copilot has no slash commands.** Always throws AdapterScopeError.
   */
  async installCommand(
    scope: ConfigScope,
    _commandName: string,
    _files: Array<{ name: string; content: string }>,
  ): Promise<void> {
    throw new AdapterScopeError('GitHub Copilot', scope, 'installCommand (Copilot has no slash commands)');
  }

  // ---------------------------------------------------------------------------
  // IInstallAdapter -- installHook
  // ---------------------------------------------------------------------------

  /**
   * Install a hook.
   *
   * **Copilot has no hook concept.** Always throws AdapterScopeError.
   */
  async installHook(
    scope: ConfigScope,
    _eventName: string,
    _matcherGroup: { matcher: string; hooks: unknown[] },
  ): Promise<void> {
    throw new AdapterScopeError('GitHub Copilot', scope, 'installHook (Copilot has no hook concept)');
  }
}
