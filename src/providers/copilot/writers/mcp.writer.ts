import type { ConfigService } from '../../../services/config.service.js';

/**
 * Writer functions for Copilot MCP server configuration mutations.
 *
 * All JSON mutations go through ConfigService.writeConfigFile() which
 * implements the safe re-read -> mutate -> validate -> backup -> write pipeline.
 * This preserves unknown fields via Zod .passthrough() schemas.
 *
 * Key difference from Claude Code writers: uses `servers` key (not `mcpServers`).
 * There is no toggleCopilotMcpServer — Copilot has no server-level disable mechanism.
 */

/**
 * Remove a Copilot MCP server entry from mcp.json.
 *
 * The mutator spreads `current` first so the `inputs` array and any other
 * top-level fields are preserved. Only the named entry in `servers` is deleted.
 */
export async function removeCopilotMcpServer(
  configService: ConfigService,
  filePath: string,
  serverName: string,
): Promise<void> {
  await configService.writeConfigFile(filePath, 'copilot-mcp', (current: Record<string, unknown>) => {
    const servers = { ...((current.servers as Record<string, unknown>) ?? {}) };
    delete servers[serverName];
    return { ...current, servers }; // spread current first — preserves `inputs`
  });
}

/**
 * Add or replace a Copilot MCP server entry in mcp.json.
 *
 * Creates the file (and .vscode/ directory) if they do not exist —
 * FileIOService.writeJsonFile() calls mkdir({ recursive: true }) automatically.
 * The mutator spreads `current` so `inputs` is preserved on write-back.
 */
export async function addCopilotMcpServer(
  configService: ConfigService,
  filePath: string,
  serverName: string,
  serverConfig: Record<string, unknown>,
): Promise<void> {
  await configService.writeConfigFile(filePath, 'copilot-mcp', (current: Record<string, unknown>) => {
    const servers = { ...((current.servers as Record<string, unknown>) ?? {}) };
    servers[serverName] = serverConfig;
    return { ...current, servers }; // spread current first — preserves `inputs`
  });
}
