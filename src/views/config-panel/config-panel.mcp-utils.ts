/**
 * Apply config-panel MCP environment edits to the active adapter's config shape.
 *
 * The container key (e.g. `mcpServers`, `servers`, `mcp_servers`) and the
 * disabled-state field are supplied by the adapter's MCP capabilities rather
 * than branched on adapter id here. A `disableField` of `undefined` means the
 * adapter cannot persist a disabled state (e.g. Copilot).
 */
export interface McpDisableField {
  field: string;
  disabledValue: unknown;
}

export function canToggleMcpStatus(disableField: McpDisableField | undefined): boolean {
  return disableField !== undefined;
}

export function applyMcpEnvUpdate<T extends Record<string, unknown>>(
  current: T,
  containerKey: string,
  disableField: McpDisableField | undefined,
  serverName: string,
  env: Record<string, string>,
  disabled?: boolean,
): T {
  const existingServers = current[containerKey] as Record<string, Record<string, unknown>> | undefined;
  const existingServer = existingServers?.[serverName];
  if (!existingServer) {
    return current;
  }

  const servers = { ...existingServers };
  const updatedServer: Record<string, unknown> = { ...existingServer, env };

  if (disableField && disabled !== undefined) {
    if (disabled) {
      updatedServer[disableField.field] = disableField.disabledValue;
    } else {
      delete updatedServer[disableField.field];
    }
  }

  servers[serverName] = updatedServer;
  return { ...current, [containerKey]: servers };
}
