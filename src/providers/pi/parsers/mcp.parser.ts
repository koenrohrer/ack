import type { FileIOService } from '../../../services/fileio.service.js';
import type { SchemaService } from '../../../services/schema.service.js';
import { ConfigScope, ToolStatus } from '../../../types/enums.js';
import type { NormalizedTool } from '../../../types/config.js';
import { makeMcpErrorTool } from '../../shared/mcp-error-tool.js';
import { extractMcpServers } from '../../shared/mcp-extract.js';

/**
 * Data shape for a single MCP server entry after validation.
 *
 * Pi MCP (pi-mcp-extension format) has NO per-server disable field -- enabling
 * and disabling is runtime-only, so every parsed server is reported Enabled.
 */
interface PiMcpServerData {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  transport?: string;
  headers?: Record<string, string>;
  lifecycle?: string;
  tools?: string[];
  [key: string]: unknown;
}

/**
 * Parse a Pi `mcp.json` file and extract MCP servers as NormalizedTool arrays.
 *
 * Handles three "no servers" states gracefully:
 * - File does not exist (data is null): returns empty array
 * - File exists but has no `mcpServers` key: returns empty array
 * - File exists but fails to read or validate: returns a single
 *   Error-status NormalizedTool
 *
 * Pi MCP has no per-server disable field, so each server is always Enabled.
 */
export async function parsePiMcpFile(
  fileIO: FileIOService,
  schemaService: SchemaService,
  filePath: string,
  scope: ConfigScope,
): Promise<NormalizedTool[]> {
  // 1. Read the JSON file
  const readResult = await fileIO.readJsonFile(filePath);

  // 2. Read error (permissions, malformed JSON) -- return error tool
  if (!readResult.success) {
    return [makeMcpErrorTool(filePath, scope, readResult.error, { idSegment: 'pi:', name: 'Pi MCP Config Error' })];
  }

  // 3. File does not exist -- valid state, return empty
  if (readResult.data === null) {
    return [];
  }

  // 4. Validate against the pi-mcp-file schema
  const validation = schemaService.validate('pi-mcp-file', readResult.data);
  if (!validation.success) {
    const message = validation.error.issues
      .map((i) => i.message)
      .join('; ');
    return [makeMcpErrorTool(filePath, scope, message, { idSegment: 'pi:', name: 'Pi MCP Config Error' })];
  }

  // 5. Extract mcpServers record
  const data = validation.data as {
    mcpServers?: Record<string, PiMcpServerData>;
  };

  const servers = data.mcpServers;
  if (!servers || Object.keys(servers).length === 0) {
    return [];
  }

  // 6. Convert each server entry to a NormalizedTool
  return extractServers(servers, scope, filePath);
}

/**
 * Convert MCP server entries from mcp.json into NormalizedTool array.
 *
 * ID format: `mcp:pi:{scope}:{serverName}` to distinguish from Claude Code
 * MCP server IDs which use `mcp:{scope}:{serverName}`.
 */
function extractServers(
  servers: Record<string, PiMcpServerData>,
  scope: ConfigScope,
  filePath: string,
): NormalizedTool[] {
  return extractMcpServers(
    servers,
    scope,
    filePath,
    (config) => ({
      // Pi MCP has no per-server disable field -- always Enabled.
      status: ToolStatus.Enabled,
      metadata: {
        command: config.command,
        args: config.args ?? [],
        url: config.url,
        env: config.env ?? {},
        transport: config.transport,
        lifecycle: config.lifecycle,
        headers: config.headers,
        tools: config.tools,
      },
    }),
    'pi:',
  );
}
