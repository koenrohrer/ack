import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ToolManagerService } from '../../services/tool-manager.service.js';
import type { ProfileService } from '../../services/profile.service.js';
import type { RegistryService } from '../../services/registry.service.js';
import type { ConfigService } from '../../services/config.service.js';
import type { InstallService } from '../../services/install.service.js';
import type { RepoScannerService } from '../../services/repo-scanner.service.js';
import type { AdapterRegistry } from '../../adapters/adapter.registry.js';
import { ConfigScope, ToolStatus, ToolType } from '../../types/enums.js';
import { buildDeleteDescription } from '../../services/tool-manager.utils.js';
import type { ToolTreeProvider } from './tool-tree.provider.js';
import type { ToolNode, GroupNode, SubToolNode, TreeNode } from './tool-tree.nodes.js';
import { MarketplacePanel } from '../marketplace/marketplace.panel.js';

const execFileAsync = promisify(execFile);

/**
 * Codex config shape used for writeTomlConfigFile mutations.
 * Mirrors the shape in config.writer.ts but defined locally
 * to avoid crossing the adapter boundary.
 */
interface CodexConfig {
  mcp_servers?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

/**
 * Register all management command handlers for the tool tree.
 *
 * Commands:
 * - toggleTool: Toggle enable/disable on writable-scope tools
 * - deleteTool: Delete with confirmation (+ "don't ask again" option)
 * - moveToolToUser: Move tool to global/user scope
 * - moveToolToProject: Move tool to project scope
 * - installTool: Placeholder for marketplace install (Phase 4)
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
  registryService: RegistryService,
  configService: ConfigService,
  outputChannel: vscode.OutputChannel,
  installService: InstallService,
  repoScannerService: RepoScannerService,
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
        registry,
        groupNode.toolType,
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Add MCP Server (Codex -- multi-step guided input flow)
  // ---------------------------------------------------------------------------

  const addMcpServerCmd = vscode.commands.registerCommand(
    'ack.addMcpServer',
    async () => {
      try {
        const adapter = registry.getActiveAdapter();
        if (!adapter || adapter.id !== 'codex') {
          vscode.window.showErrorMessage('Add MCP Server is only available for Codex.');
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

        // Step 2: Scope selection
        const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
        const scopeItems: vscode.QuickPickItem[] = [
          { label: 'User (~/.codex/)', description: 'Global configuration' },
        ];
        if (hasWorkspace) {
          scopeItems.push({ label: 'Project (.codex/)', description: 'Workspace-local configuration' });
        }

        const scopePick = await vscode.window.showQuickPick(scopeItems, {
          title: 'Add MCP Server (2/5)',
          placeHolder: 'Select configuration scope',
        });
        if (!scopePick) {
          return;
        }
        const scope = scopePick.label.startsWith('User') ? ConfigScope.User : ConfigScope.Project;

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

          serverConfig = { command, enabled: true };
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

          serverConfig = { url, enabled: true };
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

        const toolName = subNode.label;
        const serverName = subNode.parentTool.name;
        const filePath = subNode.parentTool.source.filePath;
        const currentlyEnabled = subNode.detail === 'enabled';

        // Toggle: if currently enabled, disable; if disabled, enable
        const shouldEnable = !currentlyEnabled;

        await configService.writeTomlConfigFile<CodexConfig>(
          filePath,
          'codex-config',
          (current) => {
            const servers = { ...(current.mcp_servers ?? {}) };
            const server = servers[serverName];
            if (!server) {
              return current;
            }

            const updated = { ...server };
            let enabledTools = updated.enabled_tools
              ? [...(updated.enabled_tools as string[])]
              : undefined;
            let disabledTools = updated.disabled_tools
              ? [...(updated.disabled_tools as string[])]
              : undefined;

            if (shouldEnable) {
              if (disabledTools) {
                disabledTools = disabledTools.filter((t) => t !== toolName);
                if (disabledTools.length === 0) {
                  disabledTools = undefined;
                }
              }
              if (enabledTools && !enabledTools.includes(toolName)) {
                enabledTools.push(toolName);
              }
            } else {
              if (!disabledTools) {
                disabledTools = [toolName];
              } else if (!disabledTools.includes(toolName)) {
                disabledTools.push(toolName);
              }
              if (enabledTools) {
                enabledTools = enabledTools.filter((t) => t !== toolName);
                if (enabledTools.length === 0) {
                  enabledTools = undefined;
                }
              }
            }

            updated.enabled_tools = enabledTools;
            updated.disabled_tools = disabledTools;
            if (updated.enabled_tools === undefined) {
              delete updated.enabled_tools;
            }
            if (updated.disabled_tools === undefined) {
              delete updated.disabled_tools;
            }

            servers[serverName] = updated;
            return { ...current, mcp_servers: servers };
          },
        );

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

        const serverName = toolNode.tool.name;
        const filePath = toolNode.tool.source.filePath;

        await configService.writeTomlConfigFile<CodexConfig>(
          filePath,
          'codex-config',
          (current) => {
            const servers = { ...(current.mcp_servers ?? {}) };
            const server = servers[serverName];
            if (!server) {
              return current;
            }

            const updated = { ...server };
            const env = { ...((updated.env as Record<string, string>) ?? {}) };
            env[key] = value;
            updated.env = env;

            servers[serverName] = updated;
            return { ...current, mcp_servers: servers };
          },
        );

        await treeProvider.refresh();
        vscode.window.showInformationMessage(`Environment variable '${key}' added to ${serverName}.`);
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

        const key = subNode.label;
        const serverName = subNode.parentTool.name;
        const filePath = subNode.parentTool.source.filePath;

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

        await configService.writeTomlConfigFile<CodexConfig>(
          filePath,
          'codex-config',
          (current) => {
            const servers = { ...(current.mcp_servers ?? {}) };
            const server = servers[serverName];
            if (!server) {
              return current;
            }

            const updated = { ...server };
            const env = { ...((updated.env as Record<string, string>) ?? {}) };
            env[key] = newValue;
            updated.env = env;

            servers[serverName] = updated;
            return { ...current, mcp_servers: servers };
          },
        );

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

        const key = subNode.label;
        const serverName = subNode.parentTool.name;
        const filePath = subNode.parentTool.source.filePath;

        const confirm = await vscode.window.showWarningMessage(
          `Remove env var '${key}' from ${serverName}?`,
          { modal: true },
          'Remove',
        );
        if (confirm !== 'Remove') {
          return;
        }

        await configService.writeTomlConfigFile<CodexConfig>(
          filePath,
          'codex-config',
          (current) => {
            const servers = { ...(current.mcp_servers ?? {}) };
            const server = servers[serverName];
            if (!server) {
              return current;
            }

            const updated = { ...server };
            const env = { ...((updated.env as Record<string, string>) ?? {}) };
            delete env[key];

            if (Object.keys(env).length === 0) {
              delete updated.env;
            } else {
              updated.env = env;
            }

            servers[serverName] = updated;
            return { ...current, mcp_servers: servers };
          },
        );

        await treeProvider.refresh();
        vscode.window.showInformationMessage(`Environment variable '${key}' removed from ${serverName}.`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to remove env var: ${msg}`);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Install Custom Prompt from File (Codex only)
  // ---------------------------------------------------------------------------

  const installPromptCmd = vscode.commands.registerCommand(
    'ack.installPromptFromFile',
    async () => {
      try {
        const adapter = registry.getActiveAdapter();
        if (!adapter || adapter.id !== 'codex') {
          vscode.window.showErrorMessage('Install prompt is only available for Codex.');
          return;
        }

        const uris = await vscode.window.showOpenDialog({
          canSelectMany: false,
          canSelectFolders: false,
          filters: { 'Markdown': ['md'] },
          title: 'Install Custom Prompt',
        });

        if (!uris || uris.length === 0) {
          return;
        }

        const sourceFile = uris[0].fsPath;
        const filename = path.basename(sourceFile);
        const promptName = path.basename(filename, '.md');

        // Import CodexPaths locally to avoid adapter boundary violation
        const { CodexPaths } = await import('../../adapters/codex/paths.js');
        const targetPath = path.join(CodexPaths.userPromptsDir, filename);

        // Check for conflict per CONTEXT.md
        const { access, mkdir, copyFile } = await import('fs/promises');
        let exists = false;
        try {
          await access(targetPath);
          exists = true;
        } catch {
          // File doesn't exist
        }

        if (exists) {
          const choice = await vscode.window.showWarningMessage(
            `A prompt named '${promptName}' already exists. Overwrite?`,
            { modal: true },
            'Overwrite',
          );
          if (choice !== 'Overwrite') {
            return;
          }
        }

        // Auto-create directory per CONTEXT.md
        await mkdir(path.dirname(targetPath), { recursive: true });
        await copyFile(sourceFile, targetPath);

        await treeProvider.refresh();
        vscode.window.showInformationMessage(`Custom prompt '${promptName}' installed.`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to install prompt: ${msg}`);
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

  // ---------------------------------------------------------------------------
  // Install Instruction or Prompt from File (Copilot only)
  // ---------------------------------------------------------------------------

  const installInstructionCmd = vscode.commands.registerCommand(
    'ack.installInstructionFromFile',
    async () => {
      try {
        const adapter = registry.getActiveAdapter();
        if (!adapter || adapter.id !== 'copilot') {
          vscode.window.showErrorMessage('Install instruction is only available for Copilot.');
          return;
        }

        const uris = await vscode.window.showOpenDialog({
          canSelectMany: false,
          canSelectFolders: false,
          filters: { 'Markdown': ['md'] },
          title: 'Install Copilot Instruction or Prompt',
        });

        if (!uris || uris.length === 0) {
          return;
        }

        const sourcePath = uris[0].fsPath;
        const filename = path.basename(sourcePath);

        // Validate extension — must be .instructions.md or .prompt.md
        if (!filename.endsWith('.instructions.md') && !filename.endsWith('.prompt.md')) {
          vscode.window.showErrorMessage(
            `File must end in .instructions.md or .prompt.md. Got: '${filename}'`,
          );
          return;
        }

        // Import CopilotPaths locally to avoid adapter boundary violation
        const { CopilotPaths } = await import('../../adapters/copilot/paths.js');
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
          vscode.window.showErrorMessage('No workspace folder open. Cannot install instruction.');
          return;
        }

        const targetDir = filename.endsWith('.instructions.md')
          ? CopilotPaths.workspaceInstructionsDir(workspaceRoot)
          : CopilotPaths.workspacePromptsDir(workspaceRoot);

        const targetPath = path.join(targetDir, filename);
        const { access, mkdir, copyFile } = await import('fs/promises');

        // Check for existing file
        let exists = false;
        try {
          await access(targetPath);
          exists = true;
        } catch {
          // File doesn't exist
        }

        if (exists) {
          const choice = await vscode.window.showWarningMessage(
            `'${filename}' already exists. Overwrite?`,
            { modal: true },
            'Overwrite',
          );
          if (choice !== 'Overwrite') {
            return;
          }
        }

        await mkdir(targetDir, { recursive: true });
        await copyFile(sourcePath, targetPath);

        await treeProvider.refresh();
        vscode.window.showInformationMessage(`Installed '${filename}'.`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to install instruction: ${msg}`);
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
    installPromptCmd,
    deletePromptCmd,
    installInstructionCmd,
  );
}
