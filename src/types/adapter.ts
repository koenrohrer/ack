import { ToolType, ConfigScope } from './enums.js';
import { NormalizedTool } from './config.js';

/**
 * Platform adapter interface.
 *
 * Each agent platform (Claude Code, etc.) implements this interface.
 * Adapters declare which tool types they support via `supportedToolTypes`,
 * and the extension adapts UI/behavior based on what's available.
 */
export interface IPlatformAdapter {
  readonly id: string;
  readonly displayName: string;
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
   * Remove a tool from a scope.
   */
  removeTool(toolId: string, type: ToolType, scope: ConfigScope): Promise<void>;

  /**
   * Return filesystem paths that should be watched for changes in a scope.
   */
  getWatchPaths(scope: ConfigScope): string[];

  /**
   * Detect whether this platform is available on the current system.
   */
  detect(): Promise<boolean>;
}
