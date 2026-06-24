import type { ToolCapability } from './provider-tool.js';
import type { McpCapability } from './provider-mcp.js';
import type { PathCapability } from './provider-path.js';
import type { InstallCapability } from './provider-install.js';
import type { LifecycleCapability } from './provider-lifecycle.js';

// Re-export all sub-interfaces so consumers can import from provider.ts
export type { ToolCapability } from './provider-tool.js';
export type { McpCapability } from './provider-mcp.js';
export type { PathCapability } from './provider-path.js';
export type { InstallCapability } from './provider-install.js';
export type { LifecycleCapability } from './provider-lifecycle.js';

/**
 * Optional, provider-declared capabilities that gate UI affordances and
 * behavior without callers branching on `provider.id`.
 *
 * Each flag has a matching optional method on a sub-interface (present iff the
 * flag is set) and a `ack.cap.*` context key derived from it for `when`-clauses.
 */
export interface ProviderCapabilities {
  /** Add / edit / remove environment variables on an MCP server. */
  mcpEnvVars: boolean;
  /** Enable / disable individual tools within an MCP server. */
  mcpServerToolToggle: boolean;
  /** Install a custom prompt / instruction from a local file. */
  customPromptFileInstall: boolean;
}

/** Capability defaults — every flag off — used when a provider omits `capabilities`. */
export const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  mcpEnvVars: false,
  mcpServerToolToggle: false,
  customPromptFileInstall: false,
};

/** Resolve a provider's capabilities, filling absent flags with the off default. */
export function resolveCapabilities(
  provider: Pick<AgentProvider, 'capabilities'>,
): ProviderCapabilities {
  return { ...DEFAULT_CAPABILITIES, ...provider.capabilities };
}

/**
 * Platform provider interface.
 *
 * Each agent platform (Claude Code, Codex, etc.) implements this interface.
 * Composed from focused sub-interfaces for tool operations, MCP management,
 * path resolution, installation, and lifecycle detection.
 *
 * Providers declare which tool types they support via `supportedToolTypes`,
 * and the extension adapts UI/behavior based on what's available.
 */
export interface AgentProvider extends
  ToolCapability,
  McpCapability,
  PathCapability,
  InstallCapability,
  LifecycleCapability {
  /**
   * Declared capabilities. Optional for backward compatibility (mocks/older
   * providers) — absent flags default off via {@link resolveCapabilities}.
   */
  readonly capabilities?: ProviderCapabilities;
}
