/**
 * Pure utility functions for tool tree command routing.
 *
 * Extracted from tool-tree.commands.ts to enable unit testing
 * without requiring the VS Code API module.
 */

import { ToolType } from '../../types/enums.js';
import type { NormalizedTool } from '../../types/config.js';
import type { ImportAnalysis } from '../../services/profile.types.js';
import { importConflictFields } from '../../services/profile-import.utils.js';

export { importConflictFields };

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

/** Longest error message about a bundle, which quotes bundle-supplied keys. */
const BUNDLE_ERROR_MAX = 300;

/** Most nonspacing or enclosing marks kept on one base character. */
const COMBINING_MARKS_MAX = 4;

/**
 * Matches a character hidden from bundle-supplied text: a control (newlines
 * included), a format character (bidi marks, overrides and isolates,
 * zero-width characters, soft hyphen, tags, interlinear annotation), a lone
 * surrogate, a line or paragraph separator, or a default-ignorable code point
 * (variation selectors, the combining grapheme joiner and the Hangul fillers).
 */
const HIDDEN_CHAR = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;

/** Matches a nonspacing or enclosing mark, the marks that stack. */
const COMBINING_MARK = /[\p{Mn}\p{Me}]/u;

/** Matches a spacing mark: always kept, and it does not end the count. */
const SPACING_MARK = /\p{Mc}/u;

/**
 * Make text from an untrusted profile bundle safe to show to the user.
 *
 * Removes the characters that can hide or reorder text or add lines, keeps at
 * most COMBINING_MARKS_MAX nonspacing or enclosing marks on each base
 * character (spacing marks are always kept), then clips the result to
 * BUNDLE_TEXT_MAX characters, the last one an ellipsis.
 */
export function sanitizeBundleText(value: string): string {
  return sanitize(value, BUNDLE_TEXT_MAX);
}

/**
 * Make an error message about an untrusted profile bundle safe to show.
 *
 * Same as sanitizeBundleText, but clips to BUNDLE_ERROR_MAX characters.
 */
export function sanitizeBundleError(value: string): string {
  return sanitize(value, BUNDLE_ERROR_MAX);
}

function sanitize(value: string, max: number): string {
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
    } else if (!SPACING_MARK.test(ch)) {
      marks = 0;
    }
    visible.push(ch);
  }
  if (visible.length <= max) {
    return visible.join('');
  }
  return `${visible.slice(0, max - 1).join('')}…`;
}

/**
 * One output-channel line per import conflict: the sanitized local tool name
 * and the names of the fields that differ. Never contains a field value.
 */
export function formatImportConflictReport(conflicts: ImportAnalysis['conflicts']): string[] {
  return conflicts.map(({ exported, local }) => {
    const fields = importConflictFields(exported, local);
    return `  ${sanitizeBundleText(local.name)}: ${fields.length > 0 ? fields.join(', ') : 'config'}`;
  });
}
