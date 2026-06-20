import type { ConfigScope } from './enums.js';
import type { NormalizedTool } from './config.js';

/**
 * MCP server management capability interface.
 *
 * Covers installing MCP servers and resolving MCP-specific paths
 * (config file location, schema key for validation).
 */
export interface IMcpAdapter {
  /**
   * Install an MCP server into the config file for the given scope.
   */
  installMcpServer(
    scope: ConfigScope,
    serverName: string,
    serverConfig: Record<string, unknown>,
  ): Promise<void>;

  /**
   * Return the config file path where MCP servers are defined for the scope.
   *
   * For Claude Code: User -> ~/.claude.json, Project -> {root}/.mcp.json
   */
  getMcpFilePath(scope: ConfigScope): string;

  /**
   * Return the schema key used to validate MCP config for the scope.
   *
   * For Claude Code: User -> 'claude-json', Project -> 'mcp-file'
   */
  getMcpSchemaKey(scope: ConfigScope): string;

  /**
   * The object key in the config file under which MCP servers are stored.
   *
   * Claude Code -> 'mcpServers', Codex -> 'mcp_servers', Copilot -> 'servers'.
   * Lets callers edit the right container without branching on adapter id.
   */
  getMcpContainerKey(): string;

  /**
   * Describe how a server's disabled state is persisted, or `undefined` if the
   * adapter cannot toggle MCP servers (e.g. Copilot has no disable mechanism).
   *
   * When defined, disabling sets `server[field] = disabledValue` and enabling
   * deletes `field`. Claude Code uses `{ field: 'disabled', disabledValue: true }`;
   * Codex uses `{ field: 'enabled', disabledValue: false }`.
   */
  getMcpDisableField(): { field: string; disabledValue: unknown } | undefined;

  /**
   * The on-disk format of the MCP config file.
   *
   * Codex stores MCP servers in `config.toml` -> `'toml'`; Claude Code and
   * Copilot use JSON files -> `'json'`. Lets callers pick the right reader/
   * writer without branching on adapter id.
   */
  getMcpConfigFormat(): 'toml' | 'json';

  // ---------------------------------------------------------------------------
  // Optional capability methods (present iff the matching capabilities flag set)
  // ---------------------------------------------------------------------------

  /**
   * Set an environment variable on an MCP server (add or overwrite).
   *
   * Present iff `capabilities.mcpEnvVars`. `server` is the MCP server tool; the
   * adapter resolves its own config file and format.
   */
  setMcpEnvVar?(server: NormalizedTool, key: string, value: string): Promise<void>;

  /**
   * Remove an environment variable from an MCP server.
   *
   * Present iff `capabilities.mcpEnvVars`.
   */
  removeMcpEnvVar?(server: NormalizedTool, key: string): Promise<void>;

  /**
   * Enable or disable an individual tool within an MCP server.
   *
   * Present iff `capabilities.mcpServerToolToggle`.
   */
  toggleMcpServerTool?(server: NormalizedTool, toolName: string, enable: boolean): Promise<void>;
}
