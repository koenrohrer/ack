import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ToolManagerService } from '../../services/tool-manager.service.js';
import type { ProfileService } from '../../services/profile.service.js';
import type { ConfigService } from '../../services/config.service.js';
import type { AdapterRegistry } from '../../adapters/adapter.registry.js';
import { ConfigScope, ToolStatus, ToolType } from '../../types/enums.js';
import { buildDeleteDescription } from '../../services/tool-manager.utils.js';
import { LocalInstallService } from '../../services/local-install.service.js';
import type { ToolTreeProvider } from './tool-tree.provider.js';
import type { ToolNode, GroupNode, SubToolNode, TreeNode } from './tool-tree.nodes.js';

const execFileAsync = promisify(execFile);

/**
 * Register all management command handlers for the tool tree.
 *
 * Commands:
 * - toggleTool: Toggle enable/disable on writable-scope tools
 * - deleteTool: Delete with confirmation (+ "don't ask again" option)
 * - moveToolToUser: Move tool to global/user scope
 * - moveToolToProject: Move tool to project scope
 * - installTool: Install a skill or command from local disk (by group type)
 * - addMcpServer: Multi-step guided flow to add a Codex MCP server
 * - toggleMcpTool: Toggle individual tool enabled/disabled within an MCP server
 * - addEnvVar: Add environment variable to an MCP server
 * - editEnvVar: Edit existing environment variable on an MCP server
 * - revealEnvVar: Copy environment variable value to clipboard
 * - removeEnvVar: Remove environment variable from an MCP server
 *
 * All commands receive the tree node that was right-clicked (VS Code
 * passes the TreeItem element to command handlers registered on menus).
 */
export function registerManagementCommands(
  context: vscode.ExtensionContext,
  toolManager: ToolManagerService,
  treeProvider: ToolTreeProvider,
  profileService: ProfileService,
  configService: ConfigService,
  outputChannel: vscode.OutputChannel,
  registry: AdapterRegistry,
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
  // Install Tool (local skill/command install, by group tool type)
  // ---------------------------------------------------------------------------

  const localInstall = new LocalInstallService();
  const installCmd = vscode.commands.registerCommand(
    'ack.installTool',
    async (node: TreeNode) => {
      if (!node || node.kind !== 'group') {
        return;
      }
      const groupNode = node as GroupNode;
      const adapter = registry.getActiveAdapter();
      if (!adapter) {
        vscode.window.showErrorMessage('No active agent.');
        return;
      }
      try {
        const installed = await localInstall.install(adapter, groupNode.toolType);
        if (installed) {
          outputChannel.appendLine(
            `Local install: ${groupNode.toolType} for ${adapter.displayName}`,
          );
          await treeProvider.refresh();
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Install failed: ${msg}`);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Add MCP Server (multi-step guided input flow, any MCP-capable provider)
  // ---------------------------------------------------------------------------

  const addMcpServerCmd = vscode.commands.registerCommand(
    'ack.addMcpServer',
    async () => {
      try {
        const adapter = registry.getActiveAdapter();
        if (!adapter || !adapter.supportedToolTypes.has(ToolType.McpServer)) {
          vscode.window.showErrorMessage('Add MCP Server is not supported by the active agent.');
          return;
        }

        // Step 1: Server name
        const serverName = await vscode.window.showInputBox({
          title: 'Add MCP Server (1/5)',
          prompt: 'Server name (no spaces)',
          placeHolder: 'my-server',
          validateInput: (value) => {
            if (!value || value.trim().length === 0) {
              return 'Server name is required';
            }
            if (/\s/.test(value)) {
              return 'Server name cannot contain spaces';
            }
            return undefined;
          },
        });
        if (!serverName) {
          return;
        }

        // Step 2: Scope selection (only scopes the provider supports for MCP)
        const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
        interface ScopePickItem extends vscode.QuickPickItem {
          scope: ConfigScope;
        }
        const scopeItems: ScopePickItem[] = (
          hasWorkspace ? [ConfigScope.User, ConfigScope.Project] : [ConfigScope.User]
        )
          .filter((s) => {
            try {
              adapter.getMcpFilePath(s);
              return true;
            } catch {
              return false;
            }
          })
          .map((s) => ({
            label: s === ConfigScope.User ? 'User (Global)' : 'Project (Workspace)',
            description: s === ConfigScope.User ? 'Global configuration' : 'Workspace-local configuration',
            scope: s,
          }));
        if (scopeItems.length === 0) {
          vscode.window.showErrorMessage('No MCP config location available for the active agent.');
          return;
        }

        const scopePick = await vscode.window.showQuickPick(scopeItems, {
          title: 'Add MCP Server (2/5)',
          placeHolder: 'Select configuration scope',
        });
        if (!scopePick) {
          return;
        }
        const scope = scopePick.scope;

        // Step 3: Transport type
        const transportPick = await vscode.window.showQuickPick(
          [
            { label: 'stdio (command)', description: 'Run a local command' },
            { label: 'HTTP (url)', description: 'Connect to a remote server' },
          ],
          {
            title: 'Add MCP Server (3/5)',
            placeHolder: 'Select transport type',
          },
        );
        if (!transportPick) {
          return;
        }
        const isStdio = transportPick.label.startsWith('stdio');

        let serverConfig: Record<string, unknown>;

        if (isStdio) {
          // Step 4a: Command
          const command = await vscode.window.showInputBox({
            title: 'Add MCP Server (4/5)',
            prompt: 'Command to run',
            placeHolder: 'npx',
            validateInput: (value) => {
              if (!value || value.trim().length === 0) {
                return 'Command is required';
              }
              return undefined;
            },
          });
          if (!command) {
            return;
          }

          // Step 5: Args (comma-separated, optional)
          const argsInput = await vscode.window.showInputBox({
            title: 'Add MCP Server (5/5)',
            prompt: 'Arguments (comma-separated, leave empty for none)',
            placeHolder: '-y, @modelcontextprotocol/server-github',
          });
          if (argsInput === undefined) {
            return; // Escape pressed
          }
          const parsedArgs = argsInput.trim().length > 0
            ? argsInput.split(',').map((a) => a.trim()).filter(Boolean)
            : [];

          // Step 6: Validate command exists on PATH
          try {
            await execFileAsync(command, ['--version'], { timeout: 5000 });
          } catch {
            const proceed = await vscode.window.showWarningMessage(
              `Command '${command}' not found on PATH. Continue anyway?`,
              'Continue',
              'Cancel',
            );
            if (proceed !== 'Continue') {
              return;
            }
          }

          serverConfig = { command };
          if (parsedArgs.length > 0) {
            serverConfig.args = parsedArgs;
          }
        } else {
          // Step 4b: URL
          const url = await vscode.window.showInputBox({
            title: 'Add MCP Server (4/4)',
            prompt: 'Server URL',
            placeHolder: 'https://mcp.example.com/mcp',
            validateInput: (value) => {
              if (!value || value.trim().length === 0) {
                return 'URL is required';
              }
              return undefined;
            },
          });
          if (!url) {
            return;
          }

          serverConfig = { url };
        }

        // Write to config via adapter (respects boundary)
        await adapter.installMcpServer(scope, serverName, serverConfig);
        await treeProvider.refresh();
        vscode.window.showInformationMessage(`MCP server '${serverName}' added.`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to add MCP server: ${msg}`);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Toggle MCP Tool (per-tool enable/disable within an MCP server)
  // ---------------------------------------------------------------------------

  const toggleMcpToolCmd = vscode.commands.registerCommand(
    'ack.toggleMcpTool',
    async (node: TreeNode) => {
      try {
        if (!node || node.kind !== 'subtool') {
          return;
        }
        const subNode = node as SubToolNode;
        if (subNode.subKind !== 'mcp-tool') {
          return;
        }

        const adapter = registry.getActiveAdapter();
        if (!adapter?.toggleMcpServerTool) {
          vscode.window.showErrorMessage('The active agent does not support toggling MCP tools.');
          return;
        }

        const toolName = subNode.label;
        const shouldEnable = subNode.detail !== 'enabled';

        await adapter.toggleMcpServerTool(subNode.parentTool, toolName, shouldEnable);
        await treeProvider.refresh();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to toggle tool: ${msg}`);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Add Environment Variable
  // ---------------------------------------------------------------------------

  const addEnvVarCmd = vscode.commands.registerCommand(
    'ack.addEnvVar',
    async (node: TreeNode) => {
      try {
        if (!node || node.kind !== 'tool') {
          return;
        }
        const toolNode = node as ToolNode;
        if (toolNode.tool.type !== ToolType.McpServer) {
          return;
        }

        const adapter = registry.getActiveAdapter();
        if (!adapter?.setMcpEnvVar) {
          vscode.window.showErrorMessage('The active agent does not support MCP environment variables.');
          return;
        }

        const key = await vscode.window.showInputBox({
          title: 'Add Environment Variable',
          prompt: 'Variable name',
          placeHolder: 'API_KEY',
          validateInput: (value) => {
            if (!value || value.trim().length === 0) {
              return 'Variable name is required';
            }
            return undefined;
          },
        });
        if (!key) {
          return;
        }

        const value = await vscode.window.showInputBox({
          title: 'Add Environment Variable',
          prompt: `Value for ${key}`,
          password: true,
          validateInput: (v) => {
            if (v === undefined || v.length === 0) {
              return 'Value is required';
            }
            return undefined;
          },
        });
        if (value === undefined) {
          return;
        }

        await adapter.setMcpEnvVar(toolNode.tool, key, value);

        await treeProvider.refresh();
        vscode.window.showInformationMessage(`Environment variable '${key}' added to ${toolNode.tool.name}.`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to add env var: ${msg}`);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Edit Environment Variable
  // ---------------------------------------------------------------------------

  const editEnvVarCmd = vscode.commands.registerCommand(
    'ack.editEnvVar',
    async (node: TreeNode) => {
      try {
        if (!node || node.kind !== 'subtool') {
          return;
        }
        const subNode = node as SubToolNode;
        if (subNode.subKind !== 'env-var') {
          return;
        }

        const adapter = registry.getActiveAdapter();
        if (!adapter?.setMcpEnvVar) {
          vscode.window.showErrorMessage('The active agent does not support MCP environment variables.');
          return;
        }

        const key = subNode.label;

        const newValue = await vscode.window.showInputBox({
          title: 'Edit Environment Variable',
          prompt: `Enter new value for ${key}`,
          password: true,
          validateInput: (v) => {
            if (v === undefined || v.length === 0) {
              return 'Value is required';
            }
            return undefined;
          },
        });
        if (newValue === undefined) {
          return;
        }

        await adapter.setMcpEnvVar(subNode.parentTool, key, newValue);

        await treeProvider.refresh();
        vscode.window.showInformationMessage(`Environment variable '${key}' updated.`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to edit env var: ${msg}`);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Reveal (Copy) Environment Variable Value
  // ---------------------------------------------------------------------------

  const revealEnvVarCmd = vscode.commands.registerCommand(
    'ack.revealEnvVar',
    async (node: TreeNode) => {
      try {
        if (!node || node.kind !== 'subtool') {
          return;
        }
        const subNode = node as SubToolNode;
        if (subNode.subKind !== 'env-var') {
          return;
        }

        const key = subNode.label;
        const serverName = subNode.parentTool.name;
        const scope = subNode.parentTool.scope;

        // Read fresh tools to get the actual env var value
        const tools = await configService.readToolsByScope(ToolType.McpServer, scope);
        const server = tools.find((t) => t.name === serverName);
        if (!server) {
          vscode.window.showErrorMessage(`Server '${serverName}' not found.`);
          return;
        }

        const env = server.metadata.env as Record<string, string> | undefined;
        const value = env?.[key];
        if (value === undefined) {
          vscode.window.showErrorMessage(`Env var '${key}' not found on ${serverName}.`);
          return;
        }

        await vscode.env.clipboard.writeText(value);
        vscode.window.showInformationMessage(`Copied ${key} to clipboard.`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to copy env var: ${msg}`);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Remove Environment Variable
  // ---------------------------------------------------------------------------

  const removeEnvVarCmd = vscode.commands.registerCommand(
    'ack.removeEnvVar',
    async (node: TreeNode) => {
      try {
        if (!node || node.kind !== 'subtool') {
          return;
        }
        const subNode = node as SubToolNode;
        if (subNode.subKind !== 'env-var') {
          return;
        }

        const adapter = registry.getActiveAdapter();
        if (!adapter?.removeMcpEnvVar) {
          vscode.window.showErrorMessage('The active agent does not support MCP environment variables.');
          return;
        }

        const key = subNode.label;
        const serverName = subNode.parentTool.name;

        const confirm = await vscode.window.showWarningMessage(
          `Remove env var '${key}' from ${serverName}?`,
          { modal: true },
          'Remove',
        );
        if (confirm !== 'Remove') {
          return;
        }

        await adapter.removeMcpEnvVar(subNode.parentTool, key);

        await treeProvider.refresh();
        vscode.window.showInformationMessage(`Environment variable '${key}' removed from ${serverName}.`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to remove env var: ${msg}`);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Install Custom Prompt / Instruction from File (provider capability)
  // ---------------------------------------------------------------------------

  const installCustomPromptFileCmd = vscode.commands.registerCommand(
    'ack.installCustomPromptFile',
    async () => {
      try {
        const adapter = registry.getActiveAdapter();
        if (!adapter?.installCustomPromptFile) {
          vscode.window.showErrorMessage(
            'The active agent does not support installing custom prompts from a file.',
          );
          return;
        }

        const uris = await vscode.window.showOpenDialog({
          canSelectMany: false,
          canSelectFolders: false,
          filters: { 'Markdown': ['md'] },
          title: 'Install Custom Prompt / Instruction',
        });
        if (!uris || uris.length === 0) {
          return;
        }
        const sourcePath = uris[0].fsPath;

        // The adapter owns path resolution, validation, and the write; the view
        // only picks the file and resolves the overwrite prompt on conflict.
        let result = await adapter.installCustomPromptFile(sourcePath);
        if (result.status === 'conflict') {
          const choice = await vscode.window.showWarningMessage(
            `'${result.name}' already exists. Overwrite?`,
            { modal: true },
            'Overwrite',
          );
          if (choice !== 'Overwrite') {
            return;
          }
          result = await adapter.installCustomPromptFile(sourcePath, { overwrite: true });
        }

        if (result.status === 'rejected') {
          vscode.window.showErrorMessage(result.reason);
          return;
        }

        await treeProvider.refresh();
        vscode.window.showInformationMessage(`Installed '${result.name}'.`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to install: ${msg}`);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Delete Custom Prompt (Codex only, with confirmation)
  // ---------------------------------------------------------------------------

  const deletePromptCmd = vscode.commands.registerCommand(
    'ack.deletePrompt',
    async (node: TreeNode) => {
      try {
        if (!node || node.kind !== 'tool') {
          return;
        }
        const toolNode = node as ToolNode;
        const tool = toolNode.tool;

        if (tool.type !== ToolType.CustomPrompt) {
          return;
        }

        // Per CONTEXT.md: Always confirm with modal, warn cannot be undone
        const choice = await vscode.window.showWarningMessage(
          `Delete '${tool.name}'?`,
          { modal: true, detail: 'This action cannot be undone.' },
          'Delete',
        );

        if (choice !== 'Delete') {
          return;
        }

        const { rm } = await import('fs/promises');
        await rm(tool.source.filePath);

        await treeProvider.refresh();
        vscode.window.showInformationMessage(`Custom prompt '${tool.name}' deleted.`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to delete prompt: ${msg}`);
      }
    },
  );

  context.subscriptions.push(
    toggleCmd,
    deleteCmd,
    moveToUserCmd,
    moveToProjectCmd,
    installCmd,
    addMcpServerCmd,
    toggleMcpToolCmd,
    addEnvVarCmd,
    editEnvVarCmd,
    revealEnvVarCmd,
    removeEnvVarCmd,
    installCustomPromptFileCmd,
    deletePromptCmd,
  );
}
