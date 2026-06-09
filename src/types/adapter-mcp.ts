import type { ConfigScope } from './enums.js';

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
}
