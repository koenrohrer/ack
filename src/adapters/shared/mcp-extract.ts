import { ToolType, ConfigScope, ToolStatus } from '../../types/enums.js';
import type { NormalizedTool } from '../../types/config.js';

/**
 * Per-server mapping produced by an adapter for each MCP server entry.
 *
 * `status` and `metadata` are the only parts that vary between adapters;
 * the surrounding NormalizedTool shape (id, type, name, scope, source) is
 * built identically by {@link extractMcpServers}.
 */
export interface McpServerMapping {
  status: ToolStatus;
  metadata: Record<string, unknown>;
}

/**
 * Walk an MCP server container record and build NormalizedTool entries.
 *
 * Shared across adapter MCP parsers. The common walk (entry iteration, id
 * construction, NormalizedTool assembly) lives here; each adapter supplies a
 * `map` callback that derives the per-server status + metadata from its own
 * config shape.
 *
 * The id is built as `mcp:{idSegment}{scope}:{serverName}`. Claude Code and
 * Copilot pass no segment (`mcp:{scope}:{name}`); Codex passes `codex:` to
 * produce `mcp:codex:{scope}:{name}`.
 */
export function extractMcpServers<T>(
  servers: Record<string, T>,
  scope: ConfigScope,
  filePath: string,
  map: (config: T, serverName: string) => McpServerMapping,
  idSegment = '',
): NormalizedTool[] {
  const tools: NormalizedTool[] = [];

  for (const [serverName, config] of Object.entries(servers)) {
    const { status, metadata } = map(config, serverName);

    tools.push({
      id: `mcp:${idSegment}${scope}:${serverName}`,
      type: ToolType.McpServer,
      name: serverName,
      scope,
      status,
      source: { filePath },
      metadata,
    });
  }

  return tools;
}
