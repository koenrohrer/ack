import { ToolType, ConfigScope, ToolStatus } from '../../types/enums.js';
import type { NormalizedTool } from '../../types/config.js';

/**
 * Build an Error-status NormalizedTool for an MCP config read/validation failure.
 *
 * Shared across all provider MCP parsers. The id is built as
 * `mcp-error:{idSegment}{scope}:{filePath}` where `idSegment` (e.g. `codex:`)
 * disambiguates providers that need a distinct id namespace. Claude Code and
 * Copilot pass no segment and share the `mcp-error:{scope}:{filePath}` format;
 * Codex passes `codex:` to produce `mcp-error:codex:{scope}:{filePath}`.
 */
export function makeMcpErrorTool(
  filePath: string,
  scope: ConfigScope,
  detail: string,
  options: { idSegment?: string; name?: string } = {},
): NormalizedTool {
  const { idSegment = '', name = 'MCP Config Error' } = options;
  return {
    id: `mcp-error:${idSegment}${scope}:${filePath}`,
    type: ToolType.McpServer,
    name,
    scope,
    status: ToolStatus.Error,
    statusDetail: detail,
    source: { filePath },
    metadata: {},
  };
}
