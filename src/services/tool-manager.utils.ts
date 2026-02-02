import type { NormalizedTool } from '../types/config.js';
import { ToolType, ConfigScope, ToolStatus } from '../types/enums.js';

/**
 * Actions that can be performed on a tool.
 */
export type ToolAction = 'toggle' | 'delete' | 'move';

/**
 * Get the available actions for a given tool.
 *
 * Rules:
 * - Managed scope: no actions (hidden entirely per CONTEXT)
 * - Error-status tools: only delete (can't toggle or move broken tools)
 * - Skills: toggle (directory rename), delete, move
 * - Commands: toggle (directory rename), delete, move
 * - MCP servers: toggle (disabled field), delete, move
 * - Hooks: toggle (disabled field on matcher), delete, move
 */
export function getAvailableActions(tool: NormalizedTool): ToolAction[] {
  if (isManaged(tool)) {
    return [];
  }

  if (tool.status === ToolStatus.Error) {
    return ['delete'];
  }

  return ['toggle', 'delete', 'move'];
}

/**
 * Get valid target scopes for a move operation.
 *
 * Rules:
 * - Cannot move to the scope the tool is already in
 * - Cannot move to Managed scope (read-only)
 * - Cannot move to Local scope (too niche to support)
 * - Skills: User <-> Project
 * - Commands: User <-> Project
 * - MCP servers: User <-> Project
 * - Hooks: User <-> Project (skip Local as target)
 */
export function getMoveTargets(tool: NormalizedTool): ConfigScope[] {
  if (isManaged(tool)) {
    return [];
  }

  const writableScopes = [ConfigScope.User, ConfigScope.Project];
  return writableScopes.filter((scope) => scope !== tool.scope);
}

/**
 * Check if a tool is in the managed (read-only) scope.
 */
export function isManaged(tool: NormalizedTool): boolean {
  return tool.scope === ConfigScope.Managed;
}

/**
 * Build a human-readable description of what will be deleted.
 *
 * Used for confirmation dialogs to inform the user of consequences.
 */
export function buildDeleteDescription(tool: NormalizedTool): string {
  switch (tool.type) {
    case ToolType.Skill: {
      const dirPath = tool.source.directoryPath ?? tool.source.filePath;
      return `Delete skill '${tool.name}' (directory: ${dirPath})`;
    }
    case ToolType.Command: {
      const cmdPath = tool.source.isDirectory
        ? (tool.source.directoryPath ?? tool.source.filePath)
        : tool.source.filePath;
      return `Delete command '${tool.name}' (file: ${cmdPath})`;
    }
    case ToolType.McpServer:
      return `Remove MCP server '${tool.name}' from ${tool.source.filePath}`;
    case ToolType.Hook: {
      const eventName = (tool.metadata.eventName as string) ?? 'unknown';
      const matcher = (tool.metadata.matcher as string) ?? '';
      const label = matcher ? `${eventName} (${matcher})` : eventName;
      return `Remove hook '${label}' from ${tool.source.filePath}`;
    }
    default:
      return `Delete '${tool.name}'`;
  }
}

/**
 * Check if toggling this tool would disable it (i.e., it is currently enabled).
 *
 * For skills/commands: checks if the directory name does NOT end with `.disabled`.
 * For MCP/hooks: checks if tool.status === ToolStatus.Enabled.
 */
export function isToggleDisable(tool: NormalizedTool): boolean {
  if (tool.type === ToolType.Skill || tool.type === ToolType.Command) {
    const dirOrFile = tool.source.directoryPath ?? tool.source.filePath;
    return !dirOrFile.endsWith('.disabled');
  }

  return tool.status === ToolStatus.Enabled;
}
