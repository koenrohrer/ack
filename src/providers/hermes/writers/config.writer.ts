import type { ConfigService } from '../../../services/config.service.js';

/**
 * Writer functions for Hermes YAML configuration mutations.
 *
 * All mutations go through ConfigService.writeYamlConfigFile() which
 * implements the safe re-read -> mutate -> validate -> backup -> write pipeline.
 * This preserves unknown fields via Zod .passthrough() schemas.
 *
 * Hermes differs from Claude Code:
 * - Config is YAML, not JSON
 * - MCP servers live inside config.yaml under `mcp_servers.<name>`
 * - Uses `enabled: false` to disable (vs Claude Code's `disabled: true`)
 * - Empty maps are cleaned up (removed) to keep YAML tidy
 */

/** Shape of the Hermes config.yaml for type-safe mutations. */
interface HermesConfig {
  mcp_servers?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

/**
 * Add an MCP server entry to config.yaml.
 *
 * Writes `mcp_servers.<serverName>` with the given config.
 * Creates the `mcp_servers` map if it doesn't exist.
 */
export async function addHermesMcpServer(
  configService: ConfigService,
  filePath: string,
  serverName: string,
  serverConfig: Record<string, unknown>,
): Promise<void> {
  await configService.writeYamlConfigFile<HermesConfig>(
    filePath,
    'hermes-config',
    (current) => {
      const servers = { ...(current.mcp_servers ?? {}) };
      servers[serverName] = serverConfig;
      return { ...current, mcp_servers: servers };
    },
  );
}

/**
 * Remove an MCP server entry from config.yaml.
 *
 * Deletes the `mcp_servers.<serverName>` entry. If this was the last
 * server, removes the `mcp_servers` map entirely to keep YAML clean.
 */
export async function removeHermesMcpServer(
  configService: ConfigService,
  filePath: string,
  serverName: string,
): Promise<void> {
  await configService.writeYamlConfigFile<HermesConfig>(
    filePath,
    'hermes-config',
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
 * Toggle the enabled state of an MCP server in config.yaml.
 *
 * Hermes defaults to enabled when the `enabled` key is absent.
 * - `enabled: true` -> removes the `enabled` key (default = enabled)
 * - `enabled: false` -> sets `enabled: false` explicitly
 *
 * This keeps YAML clean by not writing `enabled: true` everywhere.
 */
export async function toggleHermesMcpServer(
  configService: ConfigService,
  filePath: string,
  serverName: string,
  enabled: boolean,
): Promise<void> {
  await configService.writeYamlConfigFile<HermesConfig>(
    filePath,
    'hermes-config',
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
 * Set an environment variable for an MCP server.
 *
 * Writes to `mcp_servers.<serverName>.env`.
 * Creates the `env` object if it doesn't exist.
 */
export async function setEnvVar(
  configService: ConfigService,
  filePath: string,
  serverName: string,
  key: string,
  value: string,
): Promise<void> {
  await configService.writeYamlConfigFile<HermesConfig>(
    filePath,
    'hermes-config',
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
 * Deletes the key from `mcp_servers.<serverName>.env`. If `env` becomes
 * empty after deletion, removes the `env` key entirely.
 */
export async function removeEnvVar(
  configService: ConfigService,
  filePath: string,
  serverName: string,
  key: string,
): Promise<void> {
  await configService.writeYamlConfigFile<HermesConfig>(
    filePath,
    'hermes-config',
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
