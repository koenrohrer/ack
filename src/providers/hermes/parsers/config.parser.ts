import type { FileIOService } from '../../../services/fileio.service.js';
import type { SchemaService } from '../../../services/schema.service.js';
import { ConfigScope, ToolStatus } from '../../../types/enums.js';
import type { NormalizedTool } from '../../../types/config.js';
import { makeMcpErrorTool } from '../../shared/mcp-error-tool.js';
import { extractMcpServers } from '../../shared/mcp-extract.js';

/**
 * Data shape for a single MCP server entry after validation.
 *
 * Hermes uses `enabled` (default true) rather than Claude Code's `disabled`
 * (default false). Unlike Codex, `enabled` may be a YAML bool or a truthy
 * string -- see {@link isHermesServerEnabled}.
 */
interface HermesMcpServerData {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  auth?: string;
  oauth?: Record<string, unknown>;
  enabled?: boolean | string;
  transport?: string;
  tools?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Resolve a Hermes server's `enabled` value to a boolean.
 *
 * Hermes treats an absent `enabled` as on. The value may be a YAML bool or a
 * string; truthy strings are 'true'|'1'|'yes' (case-insensitive, trimmed) per
 * hermes_cli/mcp_config.py. Any other type defaults to enabled.
 */
export function isHermesServerEnabled(enabled: unknown): boolean {
  if (enabled === undefined || enabled === null) return true;
  if (typeof enabled === 'boolean') return enabled;
  if (typeof enabled === 'string') return ['true', '1', 'yes'].includes(enabled.trim().toLowerCase());
  return true;
}

/**
 * Parse a Hermes config.yaml file and extract MCP servers as NormalizedTool arrays.
 *
 * Handles three "no servers" states gracefully:
 * - File does not exist (data is null): returns empty array
 * - File exists but has no `mcp_servers` map: returns empty array
 * - File exists but fails to read: returns a single Error-status NormalizedTool
 *
 * The `enabled` field inversion is handled here: Hermes uses `enabled: false`
 * to mean disabled (like Codex), while Claude Code uses `disabled: true`. If
 * `enabled` is absent the server defaults to Enabled.
 */
export async function parseHermesConfigMcpServers(
  fileIO: FileIOService,
  schemaService: SchemaService,
  filePath: string,
  scope: ConfigScope,
): Promise<NormalizedTool[]> {
  // 1. Read the YAML file
  const readResult = await fileIO.readYamlFile(filePath);

  // 2. File does not exist -- valid state, return empty
  if (readResult.success && readResult.data === null) {
    return [];
  }

  // 3. Read error (permissions, malformed YAML) -- return error tool
  if (!readResult.success) {
    return [makeMcpErrorTool(filePath, scope, readResult.error, { idSegment: 'hermes:', name: 'Hermes Config Error' })];
  }

  // 4. Validate against the hermes-config schema
  const validation = schemaService.validate('hermes-config', readResult.data);
  if (!validation.success) {
    // Treat malformed config as no tools (notification handled at provider level)
    return [];
  }

  // 5. Extract mcp_servers record
  const data = validation.data as {
    mcp_servers?: Record<string, HermesMcpServerData>;
  };

  const servers = data.mcp_servers;
  if (!servers || Object.keys(servers).length === 0) {
    return [];
  }

  // 6. Convert each server entry to a NormalizedTool
  return extractServers(servers, scope, filePath);
}

/**
 * Convert MCP server entries from config.yaml into NormalizedTool array.
 *
 * ID format: `mcp:hermes:{scope}:{serverName}` to distinguish from
 * Claude Code MCP server IDs which use `mcp:{scope}:{serverName}`.
 */
function extractServers(
  servers: Record<string, HermesMcpServerData>,
  scope: ConfigScope,
  filePath: string,
): NormalizedTool[] {
  return extractMcpServers(
    servers,
    scope,
    filePath,
    (config) => ({
      // Hermes: enabled defaults to true; enabled:false (or falsy string) means disabled
      status: isHermesServerEnabled(config.enabled) ? ToolStatus.Enabled : ToolStatus.Disabled,
      metadata: {
        command: config.command,
        args: config.args ?? [],
        url: config.url,
        env: config.env ?? {},
        headers: config.headers,
        auth: config.auth,
        oauth: config.oauth,
        enabled: config.enabled,
        transport: config.transport,
        tools: config.tools,
      },
    }),
    'hermes:',
  );
}
