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
  ILifecycleAdapter {}
