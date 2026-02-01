/**
 * Pure utility functions for tool tree command routing.
 *
 * Extracted from tool-tree.commands.ts to enable unit testing
 * without requiring the VS Code API module.
 */

import { ToolType } from '../../types/enums.js';
import type { NormalizedTool } from '../../types/config.js';

/**
 * Determine the open route for a tool based on its type.
 *
 * Skills and commands are markdown files -> 'markdown'
 * MCP servers and hooks are JSON config entries -> 'json'
 */
export function getRouteForTool(
  tool: Pick<NormalizedTool, 'type'>,
): 'markdown' | 'json' {
  switch (tool.type) {
    case ToolType.Skill:
    case ToolType.Command:
      return 'markdown';
    case ToolType.McpServer:
    case ToolType.Hook:
      return 'json';
  }
}

/**
 * Derive the JSON path (for jsonc-parser) to the tool's entry in its config file.
 *
 * For MCP servers: `["mcpServers", name]`
 * For hooks: `["hooks", eventName]`
 * For markdown types: empty array (no JSON path needed)
 */
export function getJsonPath(
  tool: Pick<NormalizedTool, 'type' | 'name' | 'metadata'>,
): (string | number)[] {
  switch (tool.type) {
    case ToolType.McpServer:
      return ['mcpServers', tool.name];
    case ToolType.Hook:
      return ['hooks', tool.metadata.eventName as string];
    case ToolType.Skill:
    case ToolType.Command:
      return [];
  }
}
