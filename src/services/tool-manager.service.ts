import * as path from 'path';
import type { ConfigService } from './config.service.js';
import type { AdapterRegistry } from '../adapters/adapter.registry.js';
import type { NormalizedTool } from '../types/config.js';
import { ToolType, ConfigScope, ToolStatus } from '../types/enums.js';
import { isManaged, isToggleDisable } from './tool-manager.utils.js';

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
      const shouldDisable = isToggleDisable(tool);

      switch (tool.type) {
        case ToolType.McpServer: {
          const { toggleMcpServer } = await import(
            '../adapters/claude-code/writers/mcp.writer.js'
          );
          const { filePath, schemaKey } = this.getMcpFileInfo(tool);
          await toggleMcpServer(
            this.configService,
            filePath,
            schemaKey,
            tool.name,
            shouldDisable,
          );
          break;
        }

        case ToolType.Hook: {
          const { toggleHook } = await import(
            '../adapters/claude-code/writers/settings.writer.js'
          );
          const filePath = tool.source.filePath;
          const eventName = tool.metadata.eventName as string;
          const matcherIndex = this.parseHookMatcherIndex(tool.id);
          await toggleHook(
            this.configService,
            filePath,
            eventName,
            matcherIndex,
            shouldDisable,
          );
          break;
        }

        case ToolType.Skill: {
          const { renameSkill } = await import(
            '../adapters/claude-code/writers/skill.writer.js'
          );
          const dirPath = tool.source.directoryPath ?? path.dirname(tool.source.filePath);
          const targetPath = shouldDisable
            ? `${dirPath}.disabled`
            : dirPath.replace(/\.disabled$/, '');
          await renameSkill(dirPath, targetPath);
          break;
        }

        case ToolType.Command: {
          const { renameCommand } = await import(
            '../adapters/claude-code/writers/command.writer.js'
          );
          const cmdPath = tool.source.isDirectory
            ? (tool.source.directoryPath ?? path.dirname(tool.source.filePath))
            : tool.source.filePath;
          const targetPath = shouldDisable
            ? `${cmdPath}.disabled`
            : cmdPath.replace(/\.disabled$/, '');
          await renameCommand(cmdPath, targetPath);
          break;
        }

        default:
          return { success: false, error: `Unsupported tool type: ${tool.type}` };
      }

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

  /**
   * Determine the MCP config file path and schema key from the tool's scope.
   */
  private getMcpFileInfo(tool: NormalizedTool): { filePath: string; schemaKey: string } {
    // The source.filePath already has the correct file path from the parser
    const filePath = tool.source.filePath;
    const schemaKey = filePath.endsWith('.claude.json') ? 'claude-json' : 'mcp-file';
    return { filePath, schemaKey };
  }

  /**
   * Parse the matcher index from a hook tool ID.
   *
   * Hook ID format: "hook:{scope}:{eventName}:{index}"
   * Returns the numeric index at the end.
   */
  private parseHookMatcherIndex(hookId: string): number {
    const parts = hookId.split(':');
    const index = parseInt(parts[parts.length - 1], 10);
    if (isNaN(index)) {
      throw new Error(`Cannot parse matcher index from hook ID: ${hookId}`);
    }
    return index;
  }
}
