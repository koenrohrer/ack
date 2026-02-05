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
 * Codex MCP servers are TOML config entries -> 'toml'
 * Claude Code MCP servers and hooks are JSON config entries -> 'json'
 */
export function getRouteForTool(
  tool: Pick<NormalizedTool, 'type' | 'id'>,
): 'markdown' | 'json' | 'toml' {
  switch (tool.type) {
    case ToolType.Skill:
    case ToolType.Command:
    case ToolType.CustomPrompt:
      return 'markdown';
    case ToolType.McpServer:
      return tool.id?.includes(':codex:') ? 'toml' : 'json';
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
    case ToolType.CustomPrompt:
      return [];
  }
}

/**
 * Derive the TOML table path for a Codex tool's entry in config.toml.
 *
 * For MCP servers: `mcp_servers.{name}` (maps to `[mcp_servers.name]` table header)
 * Other types return empty string (no TOML path needed).
 */
export function getTomlPath(
  tool: Pick<NormalizedTool, 'type' | 'name'>,
): string {
  if (tool.type === ToolType.McpServer) {
    return `mcp_servers.${tool.name}`;
  }
  return '';
}
