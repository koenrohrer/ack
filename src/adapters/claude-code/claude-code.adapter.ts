import * as path from 'path';
import type { FileIOService } from '../../services/fileio.service.js';
import type { SchemaService } from '../../services/schema.service.js';
import type { ConfigService } from '../../services/config.service.js';
import type { BackupService } from '../../services/backup.service.js';
import type { IPlatformAdapter } from '../../types/adapter.js';
import type { NormalizedTool } from '../../types/config.js';
import { ToolType, ConfigScope } from '../../types/enums.js';
import { ClaudeCodePaths } from './paths.js';
import { parseSettingsFile, readDisabledMcpServers } from './parsers/settings.parser.js';
import { parseMcpFile, parseClaudeJson } from './parsers/mcp.parser.js';
import { parseSkillsDir } from './parsers/skill.parser.js';
import { parseCommandsDir } from './parsers/command.parser.js';
import { toggleMcpServer, removeMcpServer, addMcpServer } from './writers/mcp.writer.js';
import { toggleHook, removeHook, addHook } from './writers/settings.writer.js';
import { removeSkill, copySkill } from './writers/skill.writer.js';
import { removeCommand, copyCommand } from './writers/command.writer.js';

/**
 * Platform adapter for Claude Code.
 *
 * This is the ONLY module that knows about Claude Code file paths and formats.
 * It reads raw config files through the parsers and returns NormalizedTool[] arrays.
 * All file paths come exclusively from ClaudeCodePaths.
 */
export class ClaudeCodeAdapter implements IPlatformAdapter {
  readonly id = 'claude-code';
  readonly displayName = 'Claude Code';
  readonly supportedToolTypes: ReadonlySet<ToolType> = new Set([
    ToolType.Skill,
    ToolType.McpServer,
    ToolType.Hook,
    ToolType.Command,
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

  /**
   * Read all tools of a given type within a scope.
   *
   * Routes to the correct parser based on type + scope combination.
   * Returns empty array for scopes that require a workspace when none is open.
   */
  async readTools(type: ToolType, scope: ConfigScope): Promise<NormalizedTool[]> {
    // Scopes that require a workspace
    if (this.requiresWorkspace(scope) && !this.workspaceRoot) {
      return [];
    }

    switch (type) {
      case ToolType.Skill:
        return this.readSkills(scope);
      case ToolType.Command:
        return this.readCommands(scope);
      case ToolType.Hook:
        return this.readHooks(scope);
      case ToolType.McpServer:
        return this.readMcpServers(scope);
      default:
        return [];
    }
  }

  /**
   * Write (create or update) a tool within a scope.
   *
   * Routes to the correct writer based on tool type. Determines the
   * target file path and schema key from the scope.
   */
  async writeTool(tool: NormalizedTool, scope: ConfigScope): Promise<void> {
    this.ensureWriteServices();

    if (scope === ConfigScope.Managed) {
      throw new Error('Cannot write to managed scope (read-only)');
    }

    switch (tool.type) {
      case ToolType.McpServer:
        return this.writeMcpServer(tool, scope);
      case ToolType.Hook:
        return this.writeHook(tool, scope);
      case ToolType.Skill:
        return this.writeSkill(tool, scope);
      case ToolType.Command:
        return this.writeCommand(tool, scope);
      default:
        throw new Error(`Unsupported tool type: ${tool.type}`);
    }
  }

  /**
   * Remove a tool from its scope.
   *
   * Accepts the full NormalizedTool to access type, scope, source path,
   * and metadata needed to locate and remove the tool's config or files.
   */
  async removeTool(tool: NormalizedTool): Promise<void> {
    this.ensureWriteServices();

    if (tool.scope === ConfigScope.Managed) {
      throw new Error('Cannot remove from managed scope (read-only)');
    }

    switch (tool.type) {
      case ToolType.McpServer:
        return this.removeMcpServerTool(tool);
      case ToolType.Hook:
        return this.removeHookTool(tool);
      case ToolType.Skill:
        return this.removeSkillTool(tool);
      case ToolType.Command:
        return this.removeCommandTool(tool);
      default:
        throw new Error(`Unsupported tool type: ${tool.type}`);
    }
  }

  /**
   * Return filesystem paths that should be watched for changes in a scope.
   */
  getWatchPaths(scope: ConfigScope): string[] {
    switch (scope) {
      case ConfigScope.User:
        return [
          ClaudeCodePaths.userSettingsJson,
          ClaudeCodePaths.userClaudeJson,
          ClaudeCodePaths.userSkillsDir,
          ClaudeCodePaths.userCommandsDir,
        ];

      case ConfigScope.Project:
        if (!this.workspaceRoot) {
          return [];
        }
        return [
          ClaudeCodePaths.projectSettingsJson(this.workspaceRoot),
          ClaudeCodePaths.projectLocalSettingsJson(this.workspaceRoot),
          ClaudeCodePaths.projectMcpJson(this.workspaceRoot),
          ClaudeCodePaths.projectSkillsDir(this.workspaceRoot),
          ClaudeCodePaths.projectCommandsDir(this.workspaceRoot),
        ];

      case ConfigScope.Managed:
        return [
          ClaudeCodePaths.managedSettingsJson,
          ClaudeCodePaths.managedMcpJson,
        ];

      case ConfigScope.Local:
        if (!this.workspaceRoot) {
          return [];
        }
        return [
          ClaudeCodePaths.projectLocalSettingsJson(this.workspaceRoot),
        ];

      default:
        return [];
    }
  }

  /**
   * Detect whether Claude Code is available on the current system.
   *
   * Returns true if ~/.claude/ directory or ~/.claude.json file exists.
   */
  async detect(): Promise<boolean> {
    const dirExists = await this.fileIO.fileExists(ClaudeCodePaths.userClaudeDir);
    if (dirExists) {
      return true;
    }
    return this.fileIO.fileExists(ClaudeCodePaths.userClaudeJson);
  }

  // ---------------------------------------------------------------------------
  // Private routing methods
  // ---------------------------------------------------------------------------

  private async readSkills(scope: ConfigScope): Promise<NormalizedTool[]> {
    switch (scope) {
      case ConfigScope.User:
        return parseSkillsDir(this.fileIO, this.schemaService, ClaudeCodePaths.userSkillsDir, ConfigScope.User);
      case ConfigScope.Project:
        return parseSkillsDir(this.fileIO, this.schemaService, ClaudeCodePaths.projectSkillsDir(this.workspaceRoot!), ConfigScope.Project);
      default:
        return [];
    }
  }

  private async readCommands(scope: ConfigScope): Promise<NormalizedTool[]> {
    switch (scope) {
      case ConfigScope.User:
        return parseCommandsDir(this.fileIO, this.schemaService, ClaudeCodePaths.userCommandsDir, ConfigScope.User);
      case ConfigScope.Project:
        return parseCommandsDir(this.fileIO, this.schemaService, ClaudeCodePaths.projectCommandsDir(this.workspaceRoot!), ConfigScope.Project);
      default:
        return [];
    }
  }

  private async readHooks(scope: ConfigScope): Promise<NormalizedTool[]> {
    switch (scope) {
      case ConfigScope.User:
        return parseSettingsFile(this.fileIO, this.schemaService, ClaudeCodePaths.userSettingsJson, ConfigScope.User);
      case ConfigScope.Project:
        return parseSettingsFile(this.fileIO, this.schemaService, ClaudeCodePaths.projectSettingsJson(this.workspaceRoot!), ConfigScope.Project);
      case ConfigScope.Local:
        return parseSettingsFile(this.fileIO, this.schemaService, ClaudeCodePaths.projectLocalSettingsJson(this.workspaceRoot!), ConfigScope.Local);
      case ConfigScope.Managed:
        return parseSettingsFile(this.fileIO, this.schemaService, ClaudeCodePaths.managedSettingsJson, ConfigScope.Managed);
      default:
        return [];
    }
  }

  private async readMcpServers(scope: ConfigScope): Promise<NormalizedTool[]> {
    switch (scope) {
      case ConfigScope.User: {
        const disabled = await readDisabledMcpServers(this.fileIO, this.schemaService, ClaudeCodePaths.userSettingsJson);
        return parseClaudeJson(this.fileIO, this.schemaService, ClaudeCodePaths.userClaudeJson, disabled);
      }
      case ConfigScope.Project: {
        const settingsPath = ClaudeCodePaths.projectSettingsJson(this.workspaceRoot!);
        const disabled = await readDisabledMcpServers(this.fileIO, this.schemaService, settingsPath);
        return parseMcpFile(this.fileIO, this.schemaService, ClaudeCodePaths.projectMcpJson(this.workspaceRoot!), ConfigScope.Project, disabled);
      }
      case ConfigScope.Managed: {
        const disabled = await readDisabledMcpServers(this.fileIO, this.schemaService, ClaudeCodePaths.managedSettingsJson);
        return parseMcpFile(this.fileIO, this.schemaService, ClaudeCodePaths.managedMcpJson, ConfigScope.Managed, disabled);
      }
      default:
        return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Private write routing methods
  // ---------------------------------------------------------------------------

  private async writeMcpServer(tool: NormalizedTool, scope: ConfigScope): Promise<void> {
    const { filePath, schemaKey } = this.getMcpFileInfo(scope);
    const serverConfig = this.extractMcpServerConfig(tool);
    await addMcpServer(this.configService!, filePath, schemaKey, tool.name, serverConfig);
  }

  private async writeHook(tool: NormalizedTool, scope: ConfigScope): Promise<void> {
    const filePath = this.getSettingsFilePath(scope);
    const eventName = tool.metadata.eventName as string;
    const matcherGroup = {
      matcher: (tool.metadata.matcher as string) ?? '',
      hooks: (tool.metadata.hooks as Array<Record<string, unknown>>) ?? [],
    };
    await addHook(this.configService!, filePath, eventName, matcherGroup);
  }

  private async writeSkill(tool: NormalizedTool, scope: ConfigScope): Promise<void> {
    const sourceDir = tool.source.directoryPath ?? path.dirname(tool.source.filePath);
    const targetBaseDir = scope === ConfigScope.User
      ? ClaudeCodePaths.userSkillsDir
      : ClaudeCodePaths.projectSkillsDir(this.workspaceRoot!);
    const targetDir = path.join(targetBaseDir, path.basename(sourceDir));
    await copySkill(sourceDir, targetDir);
  }

  private async writeCommand(tool: NormalizedTool, scope: ConfigScope): Promise<void> {
    const sourcePath = tool.source.directoryPath ?? tool.source.filePath;
    const isDir = tool.source.isDirectory ?? false;
    const targetBaseDir = scope === ConfigScope.User
      ? ClaudeCodePaths.userCommandsDir
      : ClaudeCodePaths.projectCommandsDir(this.workspaceRoot!);
    const targetPath = path.join(targetBaseDir, path.basename(sourcePath));
    await copyCommand(sourcePath, targetPath, isDir);
  }

  // ---------------------------------------------------------------------------
  // Private remove routing methods
  // ---------------------------------------------------------------------------

  private async removeMcpServerTool(tool: NormalizedTool): Promise<void> {
    const { filePath, schemaKey } = this.getMcpFileInfo(tool.scope);
    await removeMcpServer(this.configService!, filePath, schemaKey, tool.name);
  }

  private async removeHookTool(tool: NormalizedTool): Promise<void> {
    const filePath = this.getSettingsFilePath(tool.scope);
    const eventName = tool.metadata.eventName as string;
    // Extract matcher index from tool ID (format: "hook:{scope}:{eventName}:{index}")
    const parts = tool.id.split(':');
    const matcherIndex = parseInt(parts[parts.length - 1], 10);
    await removeHook(this.configService!, filePath, eventName, matcherIndex);
  }

  private async removeSkillTool(tool: NormalizedTool): Promise<void> {
    const skillDir = tool.source.directoryPath ?? path.dirname(tool.source.filePath);
    await removeSkill(this.backupService!, skillDir);
  }

  private async removeCommandTool(tool: NormalizedTool): Promise<void> {
    const isDir = tool.source.isDirectory ?? false;
    const commandPath = isDir
      ? (tool.source.directoryPath ?? path.dirname(tool.source.filePath))
      : tool.source.filePath;
    await removeCommand(this.backupService!, commandPath, isDir);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private ensureWriteServices(): void {
    if (!this.configService || !this.backupService) {
      throw new Error(
        'ConfigService and BackupService are required for write operations. ' +
        'Pass them to the ClaudeCodeAdapter constructor.',
      );
    }
  }

  private getMcpFileInfo(scope: ConfigScope): { filePath: string; schemaKey: string } {
    switch (scope) {
      case ConfigScope.User:
        return { filePath: ClaudeCodePaths.userClaudeJson, schemaKey: 'claude-json' };
      case ConfigScope.Project:
        return { filePath: ClaudeCodePaths.projectMcpJson(this.workspaceRoot!), schemaKey: 'mcp-file' };
      default:
        throw new Error(`Cannot determine MCP file for scope: ${scope}`);
    }
  }

  private getSettingsFilePath(scope: ConfigScope): string {
    switch (scope) {
      case ConfigScope.User:
        return ClaudeCodePaths.userSettingsJson;
      case ConfigScope.Project:
        return ClaudeCodePaths.projectSettingsJson(this.workspaceRoot!);
      case ConfigScope.Local:
        return ClaudeCodePaths.projectLocalSettingsJson(this.workspaceRoot!);
      default:
        throw new Error(`Cannot determine settings file for scope: ${scope}`);
    }
  }

  private extractMcpServerConfig(tool: NormalizedTool): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    if (tool.metadata.command) { config.command = tool.metadata.command; }
    if (tool.metadata.args) { config.args = tool.metadata.args; }
    if (tool.metadata.env) { config.env = tool.metadata.env; }
    if (tool.metadata.transport) { config.transport = tool.metadata.transport; }
    if (tool.metadata.url) { config.url = tool.metadata.url; }
    return config;
  }

  private requiresWorkspace(scope: ConfigScope): boolean {
    return scope === ConfigScope.Project || scope === ConfigScope.Local;
  }
}
