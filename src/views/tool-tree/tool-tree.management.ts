import * as vscode from 'vscode';
import type { ToolManagerService } from '../../services/tool-manager.service.js';
import { ConfigScope } from '../../types/enums.js';
import { buildDeleteDescription } from '../../services/tool-manager.utils.js';
import type { ToolNode, GroupNode, TreeNode } from './tool-tree.nodes.js';

/**
 * Register all management command handlers for the tool tree.
 *
 * Commands:
 * - toggleTool: Toggle enable/disable on writable-scope tools
 * - deleteTool: Delete with confirmation (+ "don't ask again" option)
 * - moveToolToUser: Move tool to global/user scope
 * - moveToolToProject: Move tool to project scope
 * - installTool: Placeholder for marketplace install (Phase 4)
 *
 * All commands receive the tree node that was right-clicked (VS Code
 * passes the TreeItem element to command handlers registered on menus).
 * Tree auto-refreshes via file watcher -- no manual refresh needed.
 */
export function registerManagementCommands(
  context: vscode.ExtensionContext,
  toolManager: ToolManagerService,
): void {
  // ---------------------------------------------------------------------------
  // Toggle Enable/Disable
  // ---------------------------------------------------------------------------

  const toggleCmd = vscode.commands.registerCommand(
    'agent-config-keeper.toggleTool',
    async (node: TreeNode) => {
      if (!node || node.kind !== 'tool') {
        return;
      }
      const toolNode = node as ToolNode;
      const result = await toolManager.toggleTool(toolNode.tool);
      if (!result.success) {
        vscode.window.showErrorMessage(`Toggle failed: ${result.error}`);
      }
      // No success notification -- tree visual update is sufficient (CONTEXT decision)
    },
  );

  // ---------------------------------------------------------------------------
  // Delete Tool
  // ---------------------------------------------------------------------------

  const deleteCmd = vscode.commands.registerCommand(
    'agent-config-keeper.deleteTool',
    async (node: TreeNode) => {
      if (!node || node.kind !== 'tool') {
        return;
      }
      const toolNode = node as ToolNode;
      const tool = toolNode.tool;

      // Check skip-confirmation setting
      const config = vscode.workspace.getConfiguration('agentConfigKeeper');
      const skipConfirmation = config.get<boolean>('skipDeleteConfirmation', false);

      if (!skipConfirmation) {
        const description = buildDeleteDescription(tool);
        const choice = await vscode.window.showWarningMessage(
          description,
          { modal: true, detail: `This action cannot be undone.` },
          'Delete',
          "Delete & Don't Ask Again",
        );

        if (!choice) {
          return; // Cancelled
        }

        if (choice === "Delete & Don't Ask Again") {
          await config.update(
            'skipDeleteConfirmation',
            true,
            vscode.ConfigurationTarget.Global,
          );
        }
      }

      const result = await toolManager.deleteTool(tool);
      if (!result.success) {
        vscode.window.showErrorMessage(`Delete failed: ${result.error}`);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Move To User (Global)
  // ---------------------------------------------------------------------------

  const moveToUserCmd = vscode.commands.registerCommand(
    'agent-config-keeper.moveToolToUser',
    async (node: TreeNode) => {
      if (!node || node.kind !== 'tool') {
        return;
      }
      const toolNode = node as ToolNode;
      const tool = toolNode.tool;

      // Check for conflict at target scope
      const hasConflict = await toolManager.checkConflict(tool, ConfigScope.User);
      if (hasConflict) {
        const choice = await vscode.window.showWarningMessage(
          `A tool named "${tool.name}" already exists at global scope. Overwrite?`,
          { modal: true },
          'Overwrite',
        );
        if (choice !== 'Overwrite') {
          return; // Cancelled
        }
      }

      const result = await toolManager.moveTool(tool, ConfigScope.User);
      if (!result.success) {
        vscode.window.showErrorMessage(`Move failed: ${result.error}`);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Move To Project
  // ---------------------------------------------------------------------------

  const moveToProjectCmd = vscode.commands.registerCommand(
    'agent-config-keeper.moveToolToProject',
    async (node: TreeNode) => {
      if (!node || node.kind !== 'tool') {
        return;
      }
      const toolNode = node as ToolNode;
      const tool = toolNode.tool;

      // Check for conflict at target scope
      const hasConflict = await toolManager.checkConflict(tool, ConfigScope.Project);
      if (hasConflict) {
        const choice = await vscode.window.showWarningMessage(
          `A tool named "${tool.name}" already exists at project scope. Overwrite?`,
          { modal: true },
          'Overwrite',
        );
        if (choice !== 'Overwrite') {
          return; // Cancelled
        }
      }

      const result = await toolManager.moveTool(tool, ConfigScope.Project);
      if (!result.success) {
        vscode.window.showErrorMessage(`Move failed: ${result.error}`);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Install (Phase 4 placeholder)
  // ---------------------------------------------------------------------------

  const installCmd = vscode.commands.registerCommand(
    'agent-config-keeper.installTool',
    async (node: TreeNode) => {
      if (!node || node.kind !== 'group') {
        return;
      }
      const groupNode = node as GroupNode;
      vscode.window.showInformationMessage(
        `Marketplace coming in Phase 4. Tool type: ${groupNode.toolType}`,
      );
    },
  );

  context.subscriptions.push(
    toggleCmd,
    deleteCmd,
    moveToUserCmd,
    moveToProjectCmd,
    installCmd,
  );
}
