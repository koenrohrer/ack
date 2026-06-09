/**
 * Apply config-panel MCP environment edits to the active adapter's config shape.
 *
 * Claude Code uses `mcpServers`, Copilot uses `servers`, and Codex uses
 * `mcp_servers` in TOML. Disabled state is only writable for Claude and Codex.
 */
export function canToggleMcpStatus(adapterId: string | undefined): boolean {
  return adapterId !== 'copilot';
}

export function applyMcpEnvUpdate<T extends Record<string, unknown>>(
  current: T,
  adapterId: string | undefined,
  serverName: string,
  env: Record<string, string>,
  disabled?: boolean,
): T {
  switch (adapterId) {
    case 'codex':
      return updateServer(current, 'mcp_servers', serverName, env, disabled, 'codex');
    case 'copilot':
      return updateServer(current, 'servers', serverName, env, undefined, 'copilot');
    default:
      return updateServer(current, 'mcpServers', serverName, env, disabled, 'claude-code');
  }
}

function updateServer<T extends Record<string, unknown>>(
  current: T,
  containerKey: string,
  serverName: string,
  env: Record<string, string>,
  disabled: boolean | undefined,
  adapterKind: 'claude-code' | 'codex' | 'copilot',
): T {
  const existingServers = current[containerKey] as Record<string, Record<string, unknown>> | undefined;
  const existingServer = existingServers?.[serverName];
  if (!existingServer) {
    return current;
  }

  const servers = { ...existingServers };
  const updatedServer: Record<string, unknown> = { ...existingServer, env };

  if (adapterKind === 'claude-code' && disabled !== undefined) {
    if (disabled) {
      updatedServer.disabled = true;
    } else {
      delete updatedServer.disabled;
    }
  }

  if (adapterKind === 'codex' && disabled !== undefined) {
    if (disabled) {
      updatedServer.enabled = false;
    } else {
      delete updatedServer.enabled;
    }
  }

  servers[serverName] = updatedServer;
  return { ...current, [containerKey]: servers };
}
