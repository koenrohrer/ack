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
}
