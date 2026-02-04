import type { ConfigService } from './config.service.js';
import type { AdapterRegistry } from '../adapters/adapter.registry.js';
import type { NormalizedTool } from '../types/config.js';
import { ConfigScope } from '../types/enums.js';
import { isManaged } from './tool-manager.utils.js';

/**
 * Result of a tool management operation.
 */
export type ToolManagerResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Orchestrates toggle, delete, and scope-move operations for all tool types.
 *
 * This is the business logic layer between the UI command handlers (Plan 03)
 * and the adapter/writer modules (Plan 01). It handles:
 * - Managed-scope protection (reject all operations)
 * - Type-aware toggle routing (directory rename vs. JSON field)
 * - Delete via adapter
 * - Move with write-first ordering (safe for partial failure)
 * - Conflict detection at target scope
 *
 * No VS Code API dependency -- this is a pure service class.
 */
export class ToolManagerService {
  constructor(
    private readonly configService: ConfigService,
    private readonly registry: AdapterRegistry,
  ) {}

  /**
   * Toggle a tool between enabled and disabled states.
   *
   * Routing by type:
   * - Skills/Commands: rename directory/file with .disabled suffix
   * - MCP servers: set per-server disabled field in config JSON
   * - Hooks: set custom disabled field on matcher group in settings JSON
   */
  async toggleTool(tool: NormalizedTool): Promise<ToolManagerResult> {
    if (isManaged(tool)) {
      return { success: false, error: 'Cannot modify managed tools' };
    }

    try {
      const adapter = this.getAdapter();
      await adapter.toggleTool(tool);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /**
   * Delete a tool by removing its files and/or config entries.
   *
   * Delegates to the active adapter's removeTool method which routes
   * to the correct writer for the tool type.
   */
  async deleteTool(tool: NormalizedTool): Promise<ToolManagerResult> {
    if (isManaged(tool)) {
      return { success: false, error: 'Cannot modify managed tools' };
    }

    try {
      const adapter = this.getAdapter();
      await adapter.removeTool(tool);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /**
   * Move a tool from its current scope to a target scope.
   *
   * Order: write to target FIRST, then remove from source.
   * This ensures that on partial failure, the user has a duplicate
   * (recoverable) rather than data loss.
   */
  async moveTool(
    tool: NormalizedTool,
    targetScope: ConfigScope,
  ): Promise<ToolManagerResult> {
    if (isManaged(tool)) {
      return { success: false, error: 'Cannot modify managed tools' };
    }

    if (targetScope === tool.scope) {
      return { success: false, error: 'Tool is already in the target scope' };
    }

    if (targetScope === ConfigScope.Managed) {
      return { success: false, error: 'Cannot move to managed scope (read-only)' };
    }

    try {
      const adapter = this.getAdapter();

      // Step 1: Write to target scope (copy)
      await adapter.writeTool(tool, targetScope);

      // Step 2: Remove from source scope
      // If this fails, user has duplicate (recoverable) not data loss
      await adapter.removeTool(tool);

      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /**
   * Check if a tool with the same name already exists at the target scope.
   *
   * Used by the command handler to show a conflict/overwrite dialog
   * before proceeding with a move operation.
   */
  async checkConflict(
    tool: NormalizedTool,
    targetScope: ConfigScope,
  ): Promise<boolean> {
    try {
      const existingTools = await this.configService.readToolsByScope(
        tool.type,
        targetScope,
      );
      return existingTools.some((existing) => existing.name === tool.name);
    } catch {
      // If we can't read the target scope, assume no conflict
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Get the active adapter from the registry.
   * Throws if no adapter is active.
   */
  private getAdapter() {
    const adapter = this.registry.getActiveAdapter();
    if (!adapter) {
      throw new Error('No active platform adapter');
    }
    return adapter;
  }

}
