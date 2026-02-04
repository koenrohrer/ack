import type { ToolType, ConfigScope } from './enums.js';
import type { NormalizedTool } from './config.js';

/**
 * Tool read/write/toggle capability interface.
 *
 * Covers all CRUD + toggle operations for tools across scopes.
 * Adapters route by ToolType internally (MCP JSON field vs directory rename).
 */
export interface IToolAdapter {
  readonly supportedToolTypes: ReadonlySet<ToolType>;

  /**
   * Read all tools of a given type within a scope.
   */
  readTools(type: ToolType, scope: ConfigScope): Promise<NormalizedTool[]>;

  /**
   * Write (create or update) a tool within a scope.
   */
  writeTool(tool: NormalizedTool, scope: ConfigScope): Promise<void>;

  /**
   * Remove a tool from its scope.
   *
   * Accepts the full NormalizedTool so the adapter has access to
   * type, scope, source path, and metadata needed to locate and
   * remove the tool's config entries or files.
   */
  removeTool(tool: NormalizedTool): Promise<void>;

  /**
   * Toggle a tool between enabled and disabled states.
   *
   * The adapter handles type-aware routing internally:
   * - MCP servers: set disabled field in config JSON
   * - Hooks: set disabled field on matcher group in settings JSON
   * - Skills: rename directory with .disabled suffix
   * - Commands: rename file/directory with .disabled suffix
   */
  toggleTool(tool: NormalizedTool): Promise<void>;
}
