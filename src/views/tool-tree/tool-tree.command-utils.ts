/**
 * Pure utility functions for tool tree command routing.
 *
 * Extracted from tool-tree.commands.ts to enable unit testing
 * without requiring the VS Code API module.
 */

import { ToolType } from '../../types/enums.js';
import type { NormalizedTool } from '../../types/config.js';
import type { ExportedToolConfig } from '../../services/profile.types.js';

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
 * For MCP servers:
 * - Copilot mcp.json files use `["servers", name]` (Copilot's key is `servers`, not `mcpServers`)
 * - Claude Code and Codex use `["mcpServers", name]`
 * Copilot paths are identified by file path: .vscode/mcp.json (project) or
 * {Code/User}/mcp.json (user scope).
 *
 * For hooks: `["hooks", eventName]`
 * For markdown types: empty array (no JSON path needed)
 */
export function getJsonPath(
  tool: Pick<NormalizedTool, 'type' | 'name' | 'metadata' | 'source'>,
): (string | number)[] {
  switch (tool.type) {
    case ToolType.McpServer: {
      // Copilot mcp.json uses "servers" key; Claude Code and Codex use "mcpServers"
      // Copilot paths: .vscode/mcp.json (project) or {Code/User}/mcp.json (user)
      const fp = tool.source?.filePath ?? '';
      const isCopilot =
        fp.endsWith('mcp.json') &&
        (fp.includes('.vscode') || fp.includes('Code/User') || fp.includes('Code\\User'));
      return [isCopilot ? 'servers' : 'mcpServers', tool.name];
    }
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

/** Longest value describeImportedConfig shows before it truncates. */
const IMPORT_VALUE_MAX = 80;

/** Put a value on one line and truncate it, saying how much was cut. */
function clipImportValue(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  if (flat.length <= IMPORT_VALUE_MAX) {
    return flat;
  }
  return `${flat.slice(0, IMPORT_VALUE_MAX)}… (${flat.length - IMPORT_VALUE_MAX} more chars)`;
}

/**
 * Describe, on one line, what an imported config would write over a local tool.
 *
 * Shown to the user before they approve an imported config from an untrusted
 * bundle. For an MCP server: command and args, url, and the env key names
 * (never the values). For a hook group: event, matcher, and each hook's
 * command or prompt. Other kinds are never applied, so they yield ''.
 */
export function describeImportedConfig(config: ExportedToolConfig): string {
  const parts: string[] = [];
  switch (config.kind) {
    case 'mcp_server':
      if (config.command !== '') {
        parts.push(`command: ${clipImportValue([config.command, ...config.args].join(' '))}`);
      }
      if (config.url) {
        parts.push(`url: ${clipImportValue(config.url)}`);
      }
      if (Object.keys(config.env).length > 0) {
        parts.push(`env keys: ${clipImportValue(Object.keys(config.env).join(', '))}`);
      }
      break;
    case 'hook':
      parts.push(`event: ${clipImportValue(config.eventName)}`);
      parts.push(`matcher: ${config.matcher === '' ? '(any)' : clipImportValue(config.matcher)}`);
      for (const hook of config.hooks) {
        if (typeof hook.command === 'string') {
          parts.push(`command: ${clipImportValue(hook.command)}`);
        } else if (typeof hook.prompt === 'string') {
          parts.push(`prompt: ${clipImportValue(hook.prompt)}`);
        } else {
          parts.push(`hook: ${clipImportValue(JSON.stringify(hook))}`);
        }
      }
      break;
    default:
      return '';
  }
  return parts.join(' · ');
}
