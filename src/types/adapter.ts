import type { IToolAdapter } from './adapter-tool.js';
import type { IMcpAdapter } from './adapter-mcp.js';
import type { IPathAdapter } from './adapter-path.js';
import type { IInstallAdapter } from './adapter-install.js';
import type { ILifecycleAdapter } from './adapter-lifecycle.js';

// Re-export all sub-interfaces so consumers can import from adapter.ts
export type { IToolAdapter } from './adapter-tool.js';
export type { IMcpAdapter } from './adapter-mcp.js';
export type { IPathAdapter } from './adapter-path.js';
export type { IInstallAdapter } from './adapter-install.js';
export type { ILifecycleAdapter } from './adapter-lifecycle.js';

/**
 * Optional, provider-declared capabilities that gate UI affordances and
 * behavior without callers branching on `adapter.id`.
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
  adapter: Pick<IPlatformAdapter, 'capabilities'>,
): ProviderCapabilities {
  return { ...DEFAULT_CAPABILITIES, ...adapter.capabilities };
}

/**
 * Platform adapter interface.
 *
 * Each agent platform (Claude Code, Codex, etc.) implements this interface.
 * Composed from focused sub-interfaces for tool operations, MCP management,
 * path resolution, installation, and lifecycle detection.
 *
 * Adapters declare which tool types they support via `supportedToolTypes`,
 * and the extension adapts UI/behavior based on what's available.
 */
export interface IPlatformAdapter extends
  IToolAdapter,
  IMcpAdapter,
  IPathAdapter,
  IInstallAdapter,
  ILifecycleAdapter {
  /**
   * Declared capabilities. Optional for backward compatibility (mocks/older
   * adapters) — absent flags default off via {@link resolveCapabilities}.
   */
  readonly capabilities?: ProviderCapabilities;
}
