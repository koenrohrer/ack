import type { FileIOService } from '../../services/fileio.service.js';
import type { SchemaService } from '../../services/schema.service.js';
import type { IPlatformAdapter } from '../../types/adapter.js';
import type { NormalizedTool } from '../../types/config.js';
import { ToolType, ConfigScope } from '../../types/enums.js';
import { ClaudeCodePaths } from './paths.js';
import { parseSettingsFile, readDisabledMcpServers } from './parsers/settings.parser.js';
import { parseMcpFile, parseClaudeJson } from './parsers/mcp.parser.js';
import { parseSkillsDir } from './parsers/skill.parser.js';
import { parseCommandsDir } from './parsers/command.parser.js';

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
  ) {}

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
   * Stub -- will be implemented when ConfigService is built.
   */
  async writeTool(_tool: NormalizedTool, _scope: ConfigScope): Promise<void> {
    throw new Error('Not yet implemented');
  }

  /**
   * Remove a tool from a scope.
   * Stub -- will be implemented when ConfigService is built.
   */
  async removeTool(_toolId: string, _type: ToolType, _scope: ConfigScope): Promise<void> {
    throw new Error('Not yet implemented');
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

  private requiresWorkspace(scope: ConfigScope): boolean {
    return scope === ConfigScope.Project || scope === ConfigScope.Local;
  }
}
