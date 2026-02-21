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
import { parseCopilotMcpFile } from './parsers/mcp.parser.js';
import { addCopilotMcpServer, removeCopilotMcpServer } from './writers/mcp.writer.js';

/**
 * Platform adapter for GitHub Copilot.
 *
 * This is the ONLY module that knows about Copilot file paths and formats.
 * It returns NormalizedTool[] arrays from all read methods and routes path
 * resolution through CopilotPaths. All file paths come exclusively from
 * CopilotPaths.
 *
 * **Phase 21 — Full MCP read/write support:**
 * readTools, removeTool, installMcpServer, and getWatchPaths are fully
 * implemented for McpServer type. Phase 22+ adds CustomPrompt and Skill support.
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
   * Project scope: watches .vscode/mcp.json (non-empty return triggers FileWatcherManager).
   * User scope: watches {vsCodeUserDir}/mcp.json.
   */
  getWatchPaths(scope: ConfigScope): string[] {
    switch (scope) {
      case ConfigScope.Project:
        if (!this.workspaceRoot) return [];
        return [CopilotPaths.workspaceMcpJson(this.workspaceRoot)];
      case ConfigScope.User:
        return [CopilotPaths.userMcpJson(this.vsCodeUserDir)];
      default:
        return [];
    }
  }

  // ---------------------------------------------------------------------------
  // IToolAdapter -- readTools
  // ---------------------------------------------------------------------------

  /**
   * Read all tools of a given type within a scope.
   *
   * McpServer: reads from the appropriate mcp.json file via parseCopilotMcpFile.
   * CustomPrompt and Skill: returns empty (Phase 22+ implements these).
   */
  async readTools(type: ToolType, scope: ConfigScope): Promise<NormalizedTool[]> {
    if (type !== ToolType.McpServer) {
      return []; // Phase 22+ handles CustomPrompt, Skill
    }
    if (scope === ConfigScope.Project) {
      if (!this.workspaceRoot) return [];
      return parseCopilotMcpFile(
        this.fileIO,
        this.schemaService,
        CopilotPaths.workspaceMcpJson(this.workspaceRoot),
        scope,
      );
    }
    if (scope === ConfigScope.User) {
      return parseCopilotMcpFile(
        this.fileIO,
        this.schemaService,
        CopilotPaths.userMcpJson(this.vsCodeUserDir),
        scope,
      );
    }
    return [];
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
   * Remove an MCP server tool from its scope's mcp.json file.
   *
   * Delegates to removeCopilotMcpServer for McpServer type.
   * CustomPrompt and Skill removal is not implemented (Phase 22+).
   */
  async removeTool(tool: NormalizedTool): Promise<void> {
    this.ensureWriteServices();
    if (tool.type !== ToolType.McpServer) {
      throw new Error(`CopilotAdapter: removeTool not implemented for ${tool.type} (Phase 22+)`);
    }
    const filePath = this.getMcpFilePath(tool.scope);
    await removeCopilotMcpServer(this.configService!, filePath, tool.name);
  }

  // ---------------------------------------------------------------------------
  // IToolAdapter -- toggleTool
  // ---------------------------------------------------------------------------

  /**
   * Toggle a tool between enabled and disabled states.
   *
   * Copilot MCP servers have no enable/disable state — toggle is not supported.
   */
  async toggleTool(_tool: NormalizedTool): Promise<void> {
    throw new Error('CopilotAdapter: Copilot MCP servers have no enable/disable state — toggle is not supported');
  }

  // ---------------------------------------------------------------------------
  // IMcpAdapter -- installMcpServer
  // ---------------------------------------------------------------------------

  /**
   * Install an MCP server into the config file for the given scope.
   *
   * Delegates to addCopilotMcpServer, which writes to the appropriate mcp.json.
   * Creates the file (and parent directories) if they do not exist.
   */
  async installMcpServer(
    scope: ConfigScope,
    serverName: string,
    serverConfig: Record<string, unknown>,
  ): Promise<void> {
    this.ensureWriteServices();
    const filePath = this.getMcpFilePath(scope);
    await addCopilotMcpServer(this.configService!, filePath, serverName, serverConfig);
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
   * Copilot agent/skills support is implemented in Phase 23+.
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
   * Copilot skill/agent support is implemented in Phase 23+.
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
   * Copilot has no slash commands. Always throws AdapterScopeError.
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
   * Copilot has no hook concept. Always throws AdapterScopeError.
   */
  async installHook(
    scope: ConfigScope,
    _eventName: string,
    _matcherGroup: { matcher: string; hooks: unknown[] },
  ): Promise<void> {
    throw new AdapterScopeError('GitHub Copilot', scope, 'installHook (Copilot has no hook concept)');
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Assert that write services have been injected before performing mutations.
   *
   * ConfigService and BackupService are optional at construction time due to
   * circular init order. This guard ensures callers get a clear error if
   * setWriteServices() was not called before a write operation.
   */
  private ensureWriteServices(): void {
    if (!this.configService || !this.backupService) {
      throw new Error('CopilotAdapter: write services not initialized — call setWriteServices() first');
    }
  }
}
