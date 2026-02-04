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
import { AdapterScopeError } from '../../types/adapter-errors.js';
import { toggleMcpServer, removeMcpServer, addMcpServer } from './writers/mcp.writer.js';
import { toggleHook, removeHook, addHook } from './writers/settings.writer.js';
import { removeSkill, copySkill, renameSkill } from './writers/skill.writer.js';
import { removeCommand, copyCommand, renameCommand } from './writers/command.writer.js';
import { isToggleDisable } from '../../services/tool-manager.utils.js';

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
  // IToolAdapter -- toggleTool
  // ---------------------------------------------------------------------------

  /**
   * Toggle a tool between enabled and disabled states.
   *
   * Routes by tool type:
   * - MCP servers: set disabled field in config JSON
   * - Hooks: set disabled field on matcher group in settings JSON
   * - Skills: rename directory with .disabled suffix
   * - Commands: rename file/directory with .disabled suffix
   */
  async toggleTool(tool: NormalizedTool): Promise<void> {
    this.ensureWriteServices();

    const shouldDisable = isToggleDisable(tool);

    switch (tool.type) {
      case ToolType.McpServer: {
        const { filePath, schemaKey } = this.getMcpFileInfo(tool.scope);
        await toggleMcpServer(this.configService!, filePath, schemaKey, tool.name, shouldDisable);
        break;
      }

      case ToolType.Hook: {
        const filePath = tool.source.filePath;
        const eventName = tool.metadata.eventName as string;
        const parts = tool.id.split(':');
        const matcherIndex = parseInt(parts[parts.length - 1], 10);
        await toggleHook(this.configService!, filePath, eventName, matcherIndex, shouldDisable);
        break;
      }

      case ToolType.Skill: {
        const dirPath = tool.source.directoryPath ?? path.dirname(tool.source.filePath);
        const targetPath = shouldDisable
          ? `${dirPath}.disabled`
          : dirPath.replace(/\.disabled$/, '');
        await renameSkill(dirPath, targetPath);
        break;
      }

      case ToolType.Command: {
        const cmdPath = tool.source.isDirectory
          ? (tool.source.directoryPath ?? path.dirname(tool.source.filePath))
          : tool.source.filePath;
        const targetPath = shouldDisable
          ? `${cmdPath}.disabled`
          : cmdPath.replace(/\.disabled$/, '');
        await renameCommand(cmdPath, targetPath);
        break;
      }

      default:
        throw new Error(`Unsupported tool type for toggle: ${tool.type}`);
    }
  }

  // ---------------------------------------------------------------------------
  // IMcpAdapter
  // ---------------------------------------------------------------------------

  /**
   * Install an MCP server into the config file for the given scope.
   */
  async installMcpServer(
    scope: ConfigScope,
    serverName: string,
    serverConfig: Record<string, unknown>,
  ): Promise<void> {
    this.ensureWriteServices();
    const { filePath, schemaKey } = this.getMcpFileInfo(scope);
    await addMcpServer(this.configService!, filePath, schemaKey, serverName, serverConfig);
  }

  /**
   * Return the config file path where MCP servers are defined for the scope.
   */
  getMcpFilePath(scope: ConfigScope): string {
    return this.getMcpFileInfo(scope).filePath;
  }

  /**
   * Return the schema key used to validate MCP config for the scope.
   */
  getMcpSchemaKey(scope: ConfigScope): string {
    return this.getMcpFileInfo(scope).schemaKey;
  }

  // ---------------------------------------------------------------------------
  // IPathAdapter
  // ---------------------------------------------------------------------------

  /**
   * Return the skills directory path for the given scope.
   */
  getSkillsDir(scope: ConfigScope): string {
    switch (scope) {
      case ConfigScope.User:
        return ClaudeCodePaths.userSkillsDir;
      case ConfigScope.Project:
        if (!this.workspaceRoot) {
          throw new AdapterScopeError('Claude Code', scope, 'getSkillsDir (no workspace open)');
        }
        return ClaudeCodePaths.projectSkillsDir(this.workspaceRoot);
      default:
        throw new AdapterScopeError('Claude Code', scope, 'getSkillsDir');
    }
  }

  /**
   * Return the commands directory path for the given scope.
   */
  getCommandsDir(scope: ConfigScope): string {
    switch (scope) {
      case ConfigScope.User:
        return ClaudeCodePaths.userCommandsDir;
      case ConfigScope.Project:
        if (!this.workspaceRoot) {
          throw new AdapterScopeError('Claude Code', scope, 'getCommandsDir (no workspace open)');
        }
        return ClaudeCodePaths.projectCommandsDir(this.workspaceRoot);
      default:
        throw new AdapterScopeError('Claude Code', scope, 'getCommandsDir');
    }
  }

  /**
   * Return the settings file path for the given scope.
   */
  getSettingsPath(scope: ConfigScope): string {
    return this.getSettingsFilePath(scope);
  }

  // ---------------------------------------------------------------------------
  // IInstallAdapter
  // ---------------------------------------------------------------------------

  /**
   * Install a skill by writing files to the scope's skills directory.
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

  /**
   * Install a command by writing files to the scope's commands directory.
   */
  async installCommand(
    scope: ConfigScope,
    commandName: string,
    files: Array<{ name: string; content: string }>,
  ): Promise<void> {
    const { mkdir, writeFile } = await import('fs/promises');
    const baseDir = this.getCommandsDir(scope);

    if (files.length === 1) {
      // Single-file command: write directly to commands dir
      await mkdir(baseDir, { recursive: true });
      await writeFile(path.join(baseDir, files[0].name), files[0].content, 'utf-8');
    } else {
      // Multi-file command: create subdirectory
      const targetDir = path.join(baseDir, commandName);
      await mkdir(targetDir, { recursive: true });
      for (const file of files) {
        await writeFile(path.join(targetDir, file.name), file.content, 'utf-8');
      }
    }
  }

  /**
   * Install a hook by adding a matcher group to the scope's settings file.
   */
  async installHook(
    scope: ConfigScope,
    eventName: string,
    matcherGroup: { matcher: string; hooks: unknown[] },
  ): Promise<void> {
    this.ensureWriteServices();
    const filePath = this.getSettingsPath(scope);
    await addHook(
      this.configService!,
      filePath,
      eventName,
      matcherGroup as { matcher: string; hooks: Array<Record<string, unknown>>; [key: string]: unknown },
    );
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
    const stashed = tool.metadata.stashed === true;
    // Extract matcher index from tool ID (format: "hook:{scope}:{eventName}:{index}" or "hook-stashed:...")
    const parts = tool.id.split(':');
    const matcherIndex = parseInt(parts[parts.length - 1], 10);
    await removeHook(this.configService!, filePath, eventName, matcherIndex, stashed);
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
