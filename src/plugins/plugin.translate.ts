import type { PluginMcpServer } from '../types/plugin.js';
import type { McpTransportSupport } from '../types/provider-mcp.js';

/**
 * Translating one loaded `PluginMcpServer` into the native server object handed
 * to `provider.installMcpServer`, Agent Plugins 1.0.0 §7.2.1 / §7.2.2.4 / §9.1.
 *
 * This module deliberately expands nothing. `parseMcpConfig` (`plugin.mcp.ts`,
 * `buildStdioServer`) has already performed the single non-recursive §9.2 pass
 * over `args`, `env` values and `cwd`, already resolved a `./` command against
 * the plugin root and left a bare one alone. A `${PLUGIN_ROOT}` literal that
 * reaches here survived that pass and is data, not a placeholder -- expanding
 * again is precisely the second scan §9.2 forbids.
 *
 * `vars` therefore has exactly one job: supplying the two reserved names §9.1
 * requires the client to set in a stdio subprocess environment.
 *
 * Transport encoding is driven by the provider's `McpTransportSupport`
 * descriptor, never by a provider id: the agents genuinely disagree about the
 * field name, the value, and whether the transport is expressible at all.
 *
 * Pure by contract -- no `vscode`, no filesystem. Path resolution belongs to the
 * loader, and doing any of it here would mean doing it twice.
 */

/** The native server object, or the reason this server cannot be installed. */
export type TranslateResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Translate one already-resolved plugin MCP server into an agent-native config.
 *
 * Returns `ok: false` when `transport` does not list the server's transport:
 * §7.2.2.4 requires skipping such a server rather than guessing a native value
 * for it. Only the fields the server actually declares are emitted, so an
 * absent optional never reaches the config file as an explicit `undefined`.
 */
export function toNativeMcpServer(
  server: PluginMcpServer,
  /** Absolute paths of the two directories §9.1 names in the subprocess env. */
  vars: { pluginRoot: string; pluginData: string },
  transport: McpTransportSupport,
): TranslateResult {
  // A transport the descriptor omits -- or leaves undefined -- is one the agent
  // has not claimed it can express. Not claimed is not supported (§7.2.2.4).
  const nativeValue = transport.native[server.type];
  if (nativeValue === undefined) {
    return {
      ok: false,
      reason: `this agent's MCP configuration cannot express the "${server.type}" transport.`,
    };
  }

  const config: Record<string, unknown> = {};

  // `null` means the agent infers the transport from `command` vs `url`, so
  // there is no field to write. A descriptor with no `field` cannot name one
  // either, whatever value it mapped to.
  if (transport.field !== undefined && nativeValue !== null) {
    config[transport.field] = nativeValue;
  }

  if (server.type === 'stdio') {
    config.command = server.command;
    if (server.args !== undefined) {
      // Copied, not aliased: the config is handed to a provider that may edit
      // it, and the loaded plugin is kept around after the install.
      config.args = [...server.args];
    }
    if (server.cwd !== undefined) {
      config.cwd = server.cwd;
    }
    // §9.1: the plugin's own env overlays the base environment and the client
    // MUST then set the two reserved names. Writing them last makes both the
    // replacement and the ordering hold by construction.
    config.env = {
      ...server.env,
      PLUGIN_ROOT: vars.pluginRoot,
      PLUGIN_DATA: vars.pluginData,
    };
    return { ok: true, config };
  }

  // Remote transports launch no subprocess, so §9.1 injection does not apply.
  config.url = server.url;
  if (server.headers !== undefined) {
    config.headers = { ...server.headers };
  }
  return { ok: true, config };
}

/**
 * The name an installed plugin MCP server is written under (addendum §A3).
 *
 * `__` namespaces the server to its plugin without disturbing `canonicalKey`,
 * whose only separator is `:` -- a character §5.5 already forbids in a plugin
 * name, so the namespaced name round-trips through the tool-key format intact.
 */
export function installedServerName(pluginName: string, serverName: string): string {
  return `${pluginName}__${serverName}`;
}
