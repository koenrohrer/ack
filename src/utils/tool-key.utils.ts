import type { NormalizedTool } from '../types/config.js';
import { ToolType } from '../types/enums.js';

/**
 * Extract the tool type from a canonical key.
 *
 * Canonical keys use format "type:name" (e.g., "mcp_server:github") or
 * "hook:eventName:matcher" for hooks.
 *
 * Returns the ToolType enum value, or undefined if the type prefix is unrecognized.
 */
export function extractToolTypeFromKey(key: string): ToolType | undefined {
  const colonIndex = key.indexOf(':');
  if (colonIndex === -1) {
    return undefined;
  }
  const typePrefix = key.substring(0, colonIndex);
  const typeMap: Record<string, ToolType> = {
    skill: ToolType.Skill,
    mcp_server: ToolType.McpServer,
    hook: ToolType.Hook,
    command: ToolType.Command,
    custom_prompt: ToolType.CustomPrompt,
  };
  return typeMap[typePrefix];
}

/**
 * Derive a canonical key for identifying a tool across scopes.
 *
 * The key uniquely identifies the "same" tool regardless of which scope it
 * appears in. Format:
 * - Hooks: `hook:{eventName}:{matcher}` (empty string if no matcher)
 * - All others: `{type}:{name}`
 *
 * Shared between ConfigService (scope resolution) and ProfileService
 * (profile entry keys) to prevent key format drift.
 */
export function canonicalKey(tool: NormalizedTool): string {
  if (tool.type === ToolType.Hook) {
    const parts = tool.id.split(':');
    // Use type + event name + matcher for hook identity
    const eventName = tool.metadata.eventName as string | undefined;
    const matcher = tool.metadata.matcher as string | undefined;
    if (eventName) {
      return `hook:${eventName}:${matcher ?? ''}`;
    }
    // Fallback: strip last segment (scope) from id
    return parts.slice(0, -1).join(':');
  }

  return `${tool.type}:${tool.name}`;
}
