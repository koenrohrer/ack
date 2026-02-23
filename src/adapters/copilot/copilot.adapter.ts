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
import { parseCopilotInstructions } from './parsers/instructions.parser.js';
import { parseCopilotPrompts } from './parsers/prompts.parser.js';
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
    return (
      vscode.extensions.getExtension('GitHub.copilot') !== undefined ||
      vscode.extensions.getExtension('GitHub.copilot-chat') !== undefined
    );
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
   * CustomPrompt (Phase 22): reads instructions and prompt files from .github/
   *   via parseCopilotInstructions and parseCopilotPrompts (Project scope only).
   * Skill: returns empty (Phase 23+ implements these).
   */
  async readTools(type: ToolType, scope: ConfigScope): Promise<NormalizedTool[]> {
    if (type === ToolType.McpServer) {
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
    if (type === ToolType.CustomPrompt && scope === ConfigScope.Project) {
      if (!this.workspaceRoot) return [];
      const instructions = await parseCopilotInstructions(this.fileIO, this.workspaceRoot);
      const prompts = await parseCopilotPrompts(this.fileIO, this.workspaceRoot);
      return [...instructions, ...prompts];
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
   * Remove a tool from Copilot configuration.
   *
   * McpServer: delegates to removeCopilotMcpServer (modifies mcp.json).
   * CustomPrompt: deletes the instruction/prompt .md file directly via fs.rm.
   * Other types: not implemented (Phase 23+).
   */
  async removeTool(tool: NormalizedTool): Promise<void> {
    this.ensureWriteServices();
    if (tool.type === ToolType.McpServer) {
      const filePath = this.getMcpFilePath(tool.scope);
      await removeCopilotMcpServer(this.configService!, filePath, tool.name);
      return;
    }
    if (tool.type === ToolType.CustomPrompt) {
      // Direct file deletion — instruction/prompt files are single .md files
      const { rm } = await import('fs/promises');
      await rm(tool.source.filePath);
      return;
    }
    throw new Error(`CopilotAdapter: removeTool not implemented for ${tool.type} (Phase 23+)`);
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
  // Copilot-specific -- installInstruction
  // ---------------------------------------------------------------------------

  /**
   * Install an instruction or prompt file to the correct .github/ subdirectory.
   *
   * Routes by filename extension:
   * - 'copilot-instructions.md'  -> .github/copilot-instructions.md
   * - '*.instructions.md'        -> .github/instructions/<filename>
   * - '*.prompt.md'              -> .github/prompts/<filename>
   *
   * Uses fileIO.writeTextFile() for atomic write with auto-mkdir.
   */
  async installInstruction(
    _scope: ConfigScope,
    filename: string,
    content: string,
  ): Promise<void> {
    if (!this.workspaceRoot) {
      throw new AdapterScopeError('GitHub Copilot', _scope, 'installInstruction (no workspace open)');
    }
    let targetPath: string;
    if (filename === 'copilot-instructions.md') {
      targetPath = CopilotPaths.workspaceCopilotInstructionsFile(this.workspaceRoot);
    } else if (filename.endsWith('.instructions.md')) {
      targetPath = path.join(CopilotPaths.workspaceInstructionsDir(this.workspaceRoot), filename);
    } else if (filename.endsWith('.prompt.md')) {
      targetPath = path.join(CopilotPaths.workspacePromptsDir(this.workspaceRoot), filename);
    } else {
      throw new Error(
        `CopilotAdapter: unrecognized instruction/prompt filename: '${filename}'. ` +
        `Expected 'copilot-instructions.md', '*.instructions.md', or '*.prompt.md'.`,
      );
    }
    await this.fileIO.writeTextFile(targetPath, content);
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
