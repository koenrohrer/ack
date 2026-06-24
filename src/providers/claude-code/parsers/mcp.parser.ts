import type { FileIOService } from '../../../services/fileio.service.js';
import type { SchemaService } from '../../../services/schema.service.js';
import { ConfigScope, ToolStatus } from '../../../types/enums.js';
import type { NormalizedTool } from '../../../types/config.js';
import { makeMcpErrorTool } from '../../shared/mcp-error-tool.js';
import { extractMcpServers } from '../../shared/mcp-extract.js';

/**
 * Parse an MCP configuration file (.mcp.json or managed-mcp.json)
 * and extract MCP server definitions as NormalizedTool entries.
 *
 * Returns an empty array if the file does not exist.
 * Returns a single Error-status tool if the file fails validation.
 */
export async function parseMcpFile(
  fileIO: FileIOService,
  schemaService: SchemaService,
  filePath: string,
  scope: ConfigScope,
  disabledServers: string[] = [],
): Promise<NormalizedTool[]> {
  const readResult = await fileIO.readJsonFile(filePath);

  if (!readResult.success) {
    return [makeMcpErrorTool(filePath, scope, readResult.error)];
  }

  if (readResult.data === null) {
    return [];
  }

  const validation = schemaService.validate('mcp-file', readResult.data);
  if (!validation.success) {
    const message = validation.error.issues
      .map((i) => i.message)
      .join('; ');
    return [makeMcpErrorTool(filePath, scope, message)];
  }

  const data = validation.data as {
    mcpServers?: Record<string, McpServerData>;
  };

  return extractServers(data.mcpServers ?? {}, scope, filePath, disabledServers);
}

/**
 * Parse the ~/.claude.json file and extract MCP server definitions.
 *
 * Uses the ClaudeJsonSchema (which also has passthrough for non-MCP fields).
 * Scope is always User.
 */
export async function parseClaudeJson(
  fileIO: FileIOService,
  schemaService: SchemaService,
  filePath: string,
  disabledServers: string[] = [],
): Promise<NormalizedTool[]> {
  const readResult = await fileIO.readJsonFile(filePath);

  if (!readResult.success) {
    return [makeMcpErrorTool(filePath, ConfigScope.User, readResult.error)];
  }

  if (readResult.data === null) {
    return [];
  }

  const validation = schemaService.validate('claude-json', readResult.data);
  if (!validation.success) {
    const message = validation.error.issues
      .map((i) => i.message)
      .join('; ');
    return [makeMcpErrorTool(filePath, ConfigScope.User, message)];
  }

  const data = validation.data as {
    mcpServers?: Record<string, McpServerData>;
  };

  return extractServers(data.mcpServers ?? {}, ConfigScope.User, filePath, disabledServers);
}

interface McpServerData {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  type?: string;
  transport?: string;
  url?: string;
  disabled?: boolean;
  [key: string]: unknown;
}

function extractServers(
  servers: Record<string, McpServerData>,
  scope: ConfigScope,
  filePath: string,
  disabledServers: string[],
): NormalizedTool[] {
  const disabledSet = new Set(disabledServers);

  return extractMcpServers(servers, scope, filePath, (config, serverName) => {
    const isDisabled = disabledSet.has(serverName) || config.disabled === true;
    return {
      status: isDisabled ? ToolStatus.Disabled : ToolStatus.Enabled,
      metadata: {
        command: config.command,
        args: config.args ?? [],
        env: config.env ?? {},
        transport: config.transport ?? config.type,
        url: config.url,
      },
    };
  });
}
