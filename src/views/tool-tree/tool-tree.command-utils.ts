/**
 * Pure utility functions for tool tree command routing.
 *
 * Extracted from tool-tree.commands.ts to enable unit testing
 * without requiring the VS Code API module.
 */

import { ToolType } from '../../types/enums.js';
import type { NormalizedTool } from '../../types/config.js';
import type { ExportedTool, ImportAnalysis } from '../../services/profile.types.js';

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

/** Longest bundle-supplied text shown in a notification or the output channel. */
const BUNDLE_TEXT_MAX = 80;

/** Most combining marks kept on one base character. */
const COMBINING_MARKS_MAX = 2;

/**
 * Matches a character hidden from bundle-supplied text: a control (newlines
 * included), a format character (bidi marks, overrides and isolates,
 * zero-width characters, soft hyphen, tags, interlinear annotation), a lone
 * surrogate, a line or paragraph separator, or a default-ignorable code point
 * (variation selectors, the combining grapheme joiner and the Hangul fillers).
 */
const HIDDEN_CHAR = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;

/** Matches a combining mark. */
const COMBINING_MARK = /\p{M}/u;

/**
 * Make text from an untrusted profile bundle safe to show to the user.
 *
 * Removes the characters that can hide or reorder text or add lines, keeps at
 * most COMBINING_MARKS_MAX combining marks on each base character, then clips
 * the result to BUNDLE_TEXT_MAX characters, the last one an ellipsis.
 */
export function sanitizeBundleText(value: string): string {
  const visible: string[] = [];
  let marks = 0;
  for (const ch of value) {
    if (HIDDEN_CHAR.test(ch)) {
      continue;
    }
    if (COMBINING_MARK.test(ch)) {
      marks++;
      if (marks > COMBINING_MARKS_MAX) {
        continue;
      }
    } else {
      marks = 0;
    }
    visible.push(ch);
  }
  if (visible.length <= BUNDLE_TEXT_MAX) {
    return visible.join('');
  }
  return `${visible.slice(0, BUNDLE_TEXT_MAX - 1).join('')}…`;
}

/**
 * Name the config fields whose imported value differs from the local tool's.
 *
 * Returns field names only (for an MCP server: command, url, args, env; for a
 * hook group: eventName, matcher, hooks), never a value. Other kinds yield [].
 */
export function importConflictFields(exported: ExportedTool, local: NormalizedTool): string[] {
  const config = exported.config;
  const meta = local.metadata;
  const differs = (a: unknown, b: unknown): boolean => JSON.stringify(a) !== JSON.stringify(b);
  const fields: string[] = [];
  switch (config.kind) {
    case 'mcp_server':
      if (config.command !== ((meta.command as string | undefined) ?? '')) {
        fields.push('command');
      }
      if ((config.url ?? '') !== ((meta.url as string | undefined) ?? '')) {
        fields.push('url');
      }
      if (differs(config.args, meta.args ?? [])) {
        fields.push('args');
      }
      if (differs(config.env, meta.env ?? {})) {
        fields.push('env');
      }
      break;
    case 'hook':
      if (config.eventName !== ((meta.eventName as string | undefined) ?? '')) {
        fields.push('eventName');
      }
      if (config.matcher !== ((meta.matcher as string | undefined) ?? '')) {
        fields.push('matcher');
      }
      if (differs(config.hooks, meta.hooks ?? [])) {
        fields.push('hooks');
      }
      break;
    default:
      break;
  }
  return fields;
}

/**
 * One output-channel line per import conflict: the sanitized tool name and
 * the names of the fields that differ. Never contains a field value.
 */
export function formatImportConflictReport(conflicts: ImportAnalysis['conflicts']): string[] {
  return conflicts.map(({ exported, local }) => {
    const fields = importConflictFields(exported, local);
    return `  ${sanitizeBundleText(exported.name)}: ${fields.length > 0 ? fields.join(', ') : 'config'}`;
  });
}
