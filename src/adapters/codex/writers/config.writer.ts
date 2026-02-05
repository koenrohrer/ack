import type { ConfigService } from '../../../services/config.service.js';

/**
 * Writer functions for Codex TOML configuration mutations.
 *
 * All mutations go through ConfigService.writeTomlConfigFile() which
 * implements the safe re-read -> mutate -> validate -> backup -> write pipeline.
 * This preserves unknown fields via Zod .passthrough() schemas.
 *
 * Codex differs from Claude Code:
 * - Config is TOML, not JSON
 * - MCP servers live inside config.toml under [mcp_servers.<name>]
 * - Uses `enabled: false` to disable (vs Claude Code's `disabled: true`)
 * - Empty tables/arrays are cleaned up (removed) to keep TOML tidy
 */

/** Shape of the Codex config.toml for type-safe mutations. */
interface CodexConfig {
  mcp_servers?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

/**
 * Add an MCP server entry to config.toml.
 *
 * Writes `[mcp_servers.<serverName>]` table with the given config.
 * Creates the `mcp_servers` table if it doesn't exist.
 */
export async function addCodexMcpServer(
  configService: ConfigService,
  filePath: string,
  serverName: string,
  serverConfig: Record<string, unknown>,
): Promise<void> {
  await configService.writeTomlConfigFile<CodexConfig>(
    filePath,
    'codex-config',
    (current) => {
      const servers = { ...(current.mcp_servers ?? {}) };
      servers[serverName] = serverConfig;
      return { ...current, mcp_servers: servers };
    },
  );
}

/**
 * Remove an MCP server entry from config.toml.
 *
 * Deletes the `[mcp_servers.<serverName>]` table. If this was the last
 * server, removes the `mcp_servers` table entirely to keep TOML clean.
 */
export async function removeCodexMcpServer(
  configService: ConfigService,
  filePath: string,
  serverName: string,
): Promise<void> {
  await configService.writeTomlConfigFile<CodexConfig>(
    filePath,
    'codex-config',
    (current) => {
      const servers = { ...(current.mcp_servers ?? {}) };
      delete servers[serverName];

      const result = { ...current };
      if (Object.keys(servers).length === 0) {
        delete result.mcp_servers;
      } else {
        result.mcp_servers = servers;
      }
      return result;
    },
  );
}

/**
 * Toggle the enabled state of an MCP server in config.toml.
 *
 * Codex defaults to enabled when the `enabled` key is absent.
 * - `enabled: true` -> removes the `enabled` key (default = enabled)
 * - `enabled: false` -> sets `enabled: false` explicitly
 *
 * This keeps TOML clean by not writing `enabled = true` everywhere.
 */
export async function toggleCodexMcpServer(
  configService: ConfigService,
  filePath: string,
  serverName: string,
  enabled: boolean,
): Promise<void> {
  await configService.writeTomlConfigFile<CodexConfig>(
    filePath,
    'codex-config',
    (current) => {
      const servers = { ...(current.mcp_servers ?? {}) };
      const server = servers[serverName];
      if (!server) {
        return current;
      }

      const updated = { ...server };
      if (enabled) {
        delete updated.enabled;
      } else {
        updated.enabled = false;
      }

      servers[serverName] = updated;
      return { ...current, mcp_servers: servers };
    },
  );
}

/**
 * Toggle a specific tool's enabled state within an MCP server.
 *
 * Uses the two-list model: `enabled_tools` (allowlist) and `disabled_tools`
 * (blocklist). When both lists exist, `disabled_tools` takes priority.
 *
 * - Enable a tool: remove from `disabled_tools`; if `enabled_tools` exists
 *   and doesn't include the tool, add it
 * - Disable a tool: add to `disabled_tools`; if `enabled_tools` exists,
 *   remove from it
 *
 * Empty arrays are removed to keep TOML clean.
 */
export async function setToolEnabled(
  configService: ConfigService,
  filePath: string,
  serverName: string,
  toolName: string,
  enabled: boolean,
): Promise<void> {
  await configService.writeTomlConfigFile<CodexConfig>(
    filePath,
    'codex-config',
    (current) => {
      const servers = { ...(current.mcp_servers ?? {}) };
      const server = servers[serverName];
      if (!server) {
        return current;
      }

      const updated = { ...server };
      let enabledTools = updated.enabled_tools
        ? [...(updated.enabled_tools as string[])]
        : undefined;
      let disabledTools = updated.disabled_tools
        ? [...(updated.disabled_tools as string[])]
        : undefined;

      if (enabled) {
        // Remove from disabled_tools
        if (disabledTools) {
          disabledTools = disabledTools.filter((t) => t !== toolName);
          if (disabledTools.length === 0) {
            disabledTools = undefined;
          }
        }
        // If enabled_tools allowlist exists and doesn't include this tool, add it
        if (enabledTools && !enabledTools.includes(toolName)) {
          enabledTools.push(toolName);
        }
      } else {
        // Add to disabled_tools
        if (!disabledTools) {
          disabledTools = [toolName];
        } else if (!disabledTools.includes(toolName)) {
          disabledTools.push(toolName);
        }
        // If enabled_tools allowlist exists, remove this tool from it
        if (enabledTools) {
          enabledTools = enabledTools.filter((t) => t !== toolName);
          if (enabledTools.length === 0) {
            enabledTools = undefined;
          }
        }
      }

      updated.enabled_tools = enabledTools;
      updated.disabled_tools = disabledTools;

      // Clean up undefined keys so TOML omits them
      if (updated.enabled_tools === undefined) {
        delete updated.enabled_tools;
      }
      if (updated.disabled_tools === undefined) {
        delete updated.disabled_tools;
      }

      servers[serverName] = updated;
      return { ...current, mcp_servers: servers };
    },
  );
}

/**
 * Set an environment variable for an MCP server.
 *
 * Writes to `[mcp_servers.<serverName>.env]` sub-table.
 * Creates the `env` object if it doesn't exist.
 */
export async function setEnvVar(
  configService: ConfigService,
  filePath: string,
  serverName: string,
  key: string,
  value: string,
): Promise<void> {
  await configService.writeTomlConfigFile<CodexConfig>(
    filePath,
    'codex-config',
    (current) => {
      const servers = { ...(current.mcp_servers ?? {}) };
      const server = servers[serverName];
      if (!server) {
        return current;
      }

      const updated = { ...server };
      const env = { ...((updated.env as Record<string, string>) ?? {}) };
      env[key] = value;
      updated.env = env;

      servers[serverName] = updated;
      return { ...current, mcp_servers: servers };
    },
  );
}

/**
 * Remove an environment variable from an MCP server.
 *
 * Deletes the key from `[mcp_servers.<serverName>.env]`. If `env`
 * becomes empty after deletion, removes the `env` key entirely.
 */
export async function removeEnvVar(
  configService: ConfigService,
  filePath: string,
  serverName: string,
  key: string,
): Promise<void> {
  await configService.writeTomlConfigFile<CodexConfig>(
    filePath,
    'codex-config',
    (current) => {
      const servers = { ...(current.mcp_servers ?? {}) };
      const server = servers[serverName];
      if (!server) {
        return current;
      }

      const updated = { ...server };
      const env = { ...((updated.env as Record<string, string>) ?? {}) };
      delete env[key];

      if (Object.keys(env).length === 0) {
        delete updated.env;
      } else {
        updated.env = env;
      }

      servers[serverName] = updated;
      return { ...current, mcp_servers: servers };
    },
  );
}
