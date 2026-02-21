import type { FileIOService } from '../../../services/fileio.service.js';
import type { SchemaService } from '../../../services/schema.service.js';
import { ToolType, ConfigScope, ToolStatus } from '../../../types/enums.js';
import type { NormalizedTool } from '../../../types/config.js';

/**
 * Parse a Copilot MCP configuration file (mcp.json) and extract MCP server
 * definitions as NormalizedTool entries.
 *
 * Key differences from Claude Code's parseMcpFile:
 * - Uses `servers` key (not `mcpServers`)
 * - Schema key is 'copilot-mcp'
 * - No disabledServers parameter — Copilot has no disable mechanism
 * - All entries always use ToolStatus.Enabled
 * - Metadata uses config.type for transport (Copilot uses `type` field)
 *
 * Returns an empty array if the file does not exist.
 * Returns a single Error-status tool if the file fails validation.
 */
export async function parseCopilotMcpFile(
  fileIO: FileIOService,
  schemaService: SchemaService,
  filePath: string,
  scope: ConfigScope,
): Promise<NormalizedTool[]> {
  const readResult = await fileIO.readJsonFile(filePath);

  if (!readResult.success) {
    return [makeErrorTool(filePath, scope, readResult.error)];
  }

  if (readResult.data === null) {
    return [];
  }

  const validation = schemaService.validate('copilot-mcp', readResult.data);
  if (!validation.success) {
    const message = validation.error.issues
      .map((i) => i.message)
      .join('; ');
    return [makeErrorTool(filePath, scope, message)];
  }

  const data = validation.data as {
    servers?: Record<string, CopilotMcpServerData>;
  };

  return extractServers(data.servers ?? {}, scope, filePath);
}

interface CopilotMcpServerData {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  envFile?: string;
  url?: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

function extractServers(
  servers: Record<string, CopilotMcpServerData>,
  scope: ConfigScope,
  filePath: string,
): NormalizedTool[] {
  const tools: NormalizedTool[] = [];

  for (const [serverName, config] of Object.entries(servers)) {
    tools.push({
      id: `mcp:${scope}:${serverName}`,
      type: ToolType.McpServer,
      name: serverName,
      scope,
      status: ToolStatus.Enabled, // Always — Copilot has no disabled state
      source: { filePath },
      metadata: {
        command: config.command,
        args: config.args ?? [],
        env: config.env ?? {},
        transport: config.type, // Copilot uses `type` for transport
        url: config.url,
        headers: config.headers ?? {},
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
