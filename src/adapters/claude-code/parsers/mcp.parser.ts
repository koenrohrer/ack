import type { FileIOService } from '../../../services/fileio.service.js';
import type { SchemaService } from '../../../services/schema.service.js';
import { ToolType, ConfigScope, ToolStatus } from '../../../types/enums.js';
import type { NormalizedTool } from '../../../types/config.js';

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
    return [makeErrorTool(filePath, scope, readResult.error)];
  }

  if (readResult.data === null) {
    return [];
  }

  const validation = schemaService.validate('mcp-file', readResult.data);
  if (!validation.success) {
    const message = validation.error.issues
      .map((i) => i.message)
      .join('; ');
    return [makeErrorTool(filePath, scope, message)];
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
    return [makeErrorTool(filePath, ConfigScope.User, readResult.error)];
  }

  if (readResult.data === null) {
    return [];
  }

  const validation = schemaService.validate('claude-json', readResult.data);
  if (!validation.success) {
    const message = validation.error.issues
      .map((i) => i.message)
      .join('; ');
    return [makeErrorTool(filePath, ConfigScope.User, message)];
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
  const tools: NormalizedTool[] = [];
  const disabledSet = new Set(disabledServers);

  for (const [serverName, config] of Object.entries(servers)) {
    const isDisabled = disabledSet.has(serverName) || config.disabled === true;

    tools.push({
      id: `mcp:${scope}:${serverName}`,
      type: ToolType.McpServer,
      name: serverName,
      scope,
      status: isDisabled ? ToolStatus.Disabled : ToolStatus.Enabled,
      source: { filePath },
      metadata: {
        command: config.command,
        args: config.args ?? [],
        env: config.env ?? {},
        transport: config.transport ?? config.type,
        url: config.url,
      },
    });
  }

  return tools;
}

function makeErrorTool(filePath: string, scope: ConfigScope, detail: string): NormalizedTool {
  return {
    id: `mcp-error:${scope}:${filePath}`,
    type: ToolType.McpServer,
    name: 'MCP Config Error',
    scope,
    status: ToolStatus.Error,
    statusDetail: detail,
    source: { filePath },
    metadata: {},
  };
}
