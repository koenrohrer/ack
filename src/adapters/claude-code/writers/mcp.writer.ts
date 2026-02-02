import type { ConfigService } from '../../../services/config.service.js';

/**
 * Writer functions for MCP server configuration mutations.
 *
 * All JSON mutations go through ConfigService.writeConfigFile() which
 * implements the safe re-read -> mutate -> validate -> backup -> write pipeline.
 * This preserves unknown fields via Zod .passthrough() schemas.
 */

/**
 * Toggle the disabled state of an MCP server.
 *
 * Sets the per-server `disabled` field in the MCP config file.
 * Prefers per-server disabled field over the disabledMcpServers array
 * in settings (per research decision: keep disabled state co-located
 * with the server definition).
 */
export async function toggleMcpServer(
  configService: ConfigService,
  filePath: string,
  schemaKey: string,
  serverName: string,
  disabled: boolean,
): Promise<void> {
  await configService.writeConfigFile(filePath, schemaKey, (current: Record<string, unknown>) => {
    const servers = { ...((current.mcpServers as Record<string, Record<string, unknown>>) ?? {}) };
    if (servers[serverName]) {
      servers[serverName] = { ...servers[serverName], disabled };
    }
    return { ...current, mcpServers: servers };
  });
}

/**
 * Remove an MCP server entry from the config file.
 *
 * Deletes the server key from the mcpServers object.
 */
export async function removeMcpServer(
  configService: ConfigService,
  filePath: string,
  schemaKey: string,
  serverName: string,
): Promise<void> {
  await configService.writeConfigFile(filePath, schemaKey, (current: Record<string, unknown>) => {
    const servers = { ...((current.mcpServers as Record<string, unknown>) ?? {}) };
    delete servers[serverName];
    return { ...current, mcpServers: servers };
  });
}

/**
 * Add an MCP server entry to the config file.
 *
 * Sets the server config at the given name key. Used for scope move
 * (writing to the target scope's config file).
 */
export async function addMcpServer(
  configService: ConfigService,
  filePath: string,
  schemaKey: string,
  serverName: string,
  serverConfig: Record<string, unknown>,
): Promise<void> {
  await configService.writeConfigFile(filePath, schemaKey, (current: Record<string, unknown>) => {
    const servers = { ...((current.mcpServers as Record<string, unknown>) ?? {}) };
    servers[serverName] = serverConfig;
    return { ...current, mcpServers: servers };
  });
}
