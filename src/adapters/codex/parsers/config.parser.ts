import type { FileIOService } from '../../../services/fileio.service.js';
import type { SchemaService } from '../../../services/schema.service.js';
import { ToolType, ConfigScope, ToolStatus } from '../../../types/enums.js';
import type { NormalizedTool } from '../../../types/config.js';

/**
 * Data shape for a single MCP server entry after validation.
 *
 * Codex uses `enabled` (default true) rather than Claude Code's `disabled`
 * (default false). Setting `enabled: false` disables the server.
 */
interface CodexMcpServerData {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled?: boolean;
  enabled_tools?: string[];
  disabled_tools?: string[];
  [key: string]: unknown;
}

/**
 * Parse a Codex config.toml file and extract MCP servers as NormalizedTool arrays.
 *
 * Handles three "no servers" states gracefully:
 * - File does not exist (data is null): returns empty array
 * - File exists but has no `mcp_servers` table: returns empty array
 * - File exists but fails to read: returns a single Error-status NormalizedTool
 *
 * The `enabled` field inversion is handled here: Codex uses `enabled: false`
 * to mean disabled, while Claude Code uses `disabled: true`. If `enabled`
 * is undefined, the server defaults to Enabled.
 */
export async function parseCodexConfigMcpServers(
  fileIO: FileIOService,
  schemaService: SchemaService,
  filePath: string,
  scope: ConfigScope,
): Promise<NormalizedTool[]> {
  // 1. Read the TOML file
  const readResult = await fileIO.readTomlFile(filePath);

  // 2. File does not exist -- valid state, return empty
  if (readResult.success && readResult.data === null) {
    return [];
  }

  // 3. Read error (permissions, malformed TOML) -- return error tool
  if (!readResult.success) {
    return [makeErrorTool(filePath, scope, readResult.error)];
  }

  // 4. Validate against the codex-config schema
  const validation = schemaService.validate('codex-config', readResult.data);
  if (!validation.success) {
    // Treat malformed config as no tools (notification handled at adapter level)
    return [];
  }

  // 5. Extract mcp_servers record
  const data = validation.data as {
    mcp_servers?: Record<string, CodexMcpServerData>;
  };

  const servers = data.mcp_servers;
  if (!servers || Object.keys(servers).length === 0) {
    return [];
  }

  // 6. Convert each server entry to a NormalizedTool
  return extractServers(servers, scope, filePath);
}

/**
 * Convert MCP server entries from config.toml into NormalizedTool array.
 *
 * ID format: `mcp:codex:{scope}:{serverName}` to distinguish from
 * Claude Code MCP server IDs which use `mcp:{scope}:{serverName}`.
 */
function extractServers(
  servers: Record<string, CodexMcpServerData>,
  scope: ConfigScope,
  filePath: string,
): NormalizedTool[] {
  const tools: NormalizedTool[] = [];

  for (const [serverName, config] of Object.entries(servers)) {
    // Codex: enabled defaults to true; enabled:false means disabled
    const isDisabled = config.enabled === false;

    tools.push({
      id: `mcp:codex:${scope}:${serverName}`,
      type: ToolType.McpServer,
      name: serverName,
      scope,
      status: isDisabled ? ToolStatus.Disabled : ToolStatus.Enabled,
      source: { filePath },
      metadata: {
        command: config.command,
        args: config.args ?? [],
        url: config.url,
        env: config.env ?? {},
        enabled: config.enabled,
        enabled_tools: config.enabled_tools,
        disabled_tools: config.disabled_tools,
      },
    });
  }

  return tools;
}

/**
 * Create an error-status NormalizedTool for read failures.
 *
 * Mirrors the pattern used by Claude Code's MCP parser for consistency
 * in how errors surface to the UI.
 */
function makeErrorTool(filePath: string, scope: ConfigScope, detail: string): NormalizedTool {
  return {
    id: `mcp-error:codex:${scope}:${filePath}`,
    type: ToolType.McpServer,
    name: 'Codex Config Error',
    scope,
    status: ToolStatus.Error,
    statusDetail: detail,
    source: { filePath },
    metadata: {},
  };
}
