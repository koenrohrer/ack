import * as vscode from 'vscode';
import type { ToolManagerService } from '../../services/tool-manager.service.js';
import type { ProfileService } from '../../services/profile.service.js';
import type { RegistryService } from '../../services/registry.service.js';
import type { ConfigService } from '../../services/config.service.js';
import type { InstallService } from '../../services/install.service.js';
import type { RepoScannerService } from '../../services/repo-scanner.service.js';
import { ConfigScope, ToolStatus } from '../../types/enums.js';
import { buildDeleteDescription } from '../../services/tool-manager.utils.js';
import type { ToolTreeProvider } from './tool-tree.provider.js';
import type { ToolNode, GroupNode, TreeNode } from './tool-tree.nodes.js';
import { MarketplacePanel } from '../marketplace/marketplace.panel.js';

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
 */
export function registerManagementCommands(
  context: vscode.ExtensionContext,
  toolManager: ToolManagerService,
  treeProvider: ToolTreeProvider,
  profileService: ProfileService,
  registryService: RegistryService,
  configService: ConfigService,
  outputChannel: vscode.OutputChannel,
  installService: InstallService,
  repoScannerService: RepoScannerService,
): void {
  // ---------------------------------------------------------------------------
  // Toggle Enable/Disable
  // ---------------------------------------------------------------------------

  const toggleCmd = vscode.commands.registerCommand(
    'ack.toggleTool',
    async (node: TreeNode) => {
      if (!node || node.kind !== 'tool') {
        return;
      }
      const toolNode = node as ToolNode;
      const wasEnabled = toolNode.tool.status === ToolStatus.Enabled;
      const result = await toolManager.toggleTool(toolNode.tool);
      if (!result.success) {
        vscode.window.showErrorMessage(`Toggle failed: ${result.error}`);
        return;
      }
      // Sync new state to active profile (no-op if no profile is active)
      await profileService.syncToolToActiveProfile(toolNode.tool, !wasEnabled);
      // Explicitly refresh tree — directory renames (skills/commands) may not
      // trigger the file watcher reliably
      await treeProvider.refresh();
    },
  );

  // ---------------------------------------------------------------------------
  // Delete Tool
  // ---------------------------------------------------------------------------

  const deleteCmd = vscode.commands.registerCommand(
    'ack.deleteTool',
    async (node: TreeNode) => {
      if (!node || node.kind !== 'tool') {
        return;
      }
      const toolNode = node as ToolNode;
      const tool = toolNode.tool;

      // Check skip-confirmation setting
      const config = vscode.workspace.getConfiguration('ack');
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
        return;
      }
      // Remove from active profile (no-op if no profile is active)
      await profileService.removeToolFromActiveProfile(tool);
    },
  );

  // ---------------------------------------------------------------------------
  // Move To User (Global)
  // ---------------------------------------------------------------------------

  const moveToUserCmd = vscode.commands.registerCommand(
    'ack.moveToolToUser',
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
    'ack.moveToolToProject',
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
  // Install via Marketplace (filtered by tool type)
  // ---------------------------------------------------------------------------

  const installCmd = vscode.commands.registerCommand(
    'ack.installTool',
    async (node: TreeNode) => {
      if (!node || node.kind !== 'group') {
        return;
      }
      const groupNode = node as GroupNode;
      MarketplacePanel.createOrShow(
        context.extensionUri,
        registryService,
        configService,
        outputChannel,
        installService,
        toolManager,
        repoScannerService,
        groupNode.toolType,
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
