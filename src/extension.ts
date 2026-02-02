import * as vscode from 'vscode';
import { FileIOService } from './services/fileio.service.js';
import { BackupService } from './services/backup.service.js';
import { SchemaService } from './services/schema.service.js';
import { ConfigService } from './services/config.service.js';
import { AdapterRegistry } from './adapters/adapter.registry.js';
import { ClaudeCodeAdapter } from './adapters/claude-code/claude-code.adapter.js';
import { claudeCodeSchemas } from './adapters/claude-code/schemas.js';
import { ToolTreeProvider } from './views/tool-tree/tool-tree.provider.js';
import { registerToolTreeCommands } from './views/tool-tree/tool-tree.commands.js';
import { registerManagementCommands } from './views/tool-tree/tool-tree.management.js';
import { registerProfileCommands } from './views/tool-tree/tool-tree.profile-commands.js';
import { ToolManagerService } from './services/tool-manager.service.js';
import { ProfileService } from './services/profile.service.js';
import { FileWatcherManager } from './views/file-watcher.manager.js';
import { MarketplacePanel } from './views/marketplace/marketplace.panel.js';
import { ConfigPanel } from './views/config-panel/config-panel.panel.js';
import { RegistryService } from './services/registry.service.js';
import { InstallService } from './services/install.service.js';
import { WorkspaceProfileService } from './services/workspace-profile.service.js';

/**
 * Service container for cross-module access to initialized services.
 *
 * Set during activate(), cleared during deactivate().
 * Future phases use getServices() to access the singleton instances.
 */
let services:
  | {
      configService: ConfigService;
      registry: AdapterRegistry;
      toolManager: ToolManagerService;
      registryService: RegistryService;
      workspaceProfileService: WorkspaceProfileService;
      outputChannel: vscode.OutputChannel;
    }
  | undefined;

/**
 * Access the initialized service instances.
 *
 * Throws if called before activate() completes -- callers should
 * only use this from command handlers and event listeners, which
 * are guaranteed to run after activation.
 */
export function getServices(): {
  configService: ConfigService;
  registry: AdapterRegistry;
  toolManager: ToolManagerService;
  registryService: RegistryService;
  workspaceProfileService: WorkspaceProfileService;
  outputChannel: vscode.OutputChannel;
} {
  if (!services) {
    throw new Error('Extension not activated');
  }
  return services;
}

export function activate(context: vscode.ExtensionContext): void {
  // 1. Output channel for diagnostics
  const outputChannel = vscode.window.createOutputChannel('Agent Config Keeper');
  context.subscriptions.push(outputChannel);

  // 2. Core services
  const fileIO = new FileIOService();
  const backup = new BackupService();
  const schemas = new SchemaService();

  // 3. Register Claude Code schemas
  schemas.registerSchemas(claudeCodeSchemas);

  // 4. Workspace root (undefined when no folder is open)
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // 5. Adapter setup
  const registry = new AdapterRegistry();
  const claudeAdapter = new ClaudeCodeAdapter(fileIO, schemas, workspaceRoot);
  registry.register(claudeAdapter);

  // 6. Config service (the main API for reading/writing tool configs)
  const configService = new ConfigService(fileIO, backup, schemas, registry);

  // 6b. Inject write services into adapter now that configService exists
  claudeAdapter.setWriteServices(configService, backup);

  // 7. Tool management service
  const toolManager = new ToolManagerService(configService, registry);

  // 8. Registry service for marketplace data
  const registryService = new RegistryService(context);

  // 9. Install service for one-click marketplace installs
  const installService = new InstallService(
    registryService, configService, registry, fileIO, workspaceRoot,
  );

  // 9b. Profile service for named tool presets
  const profileService = new ProfileService(context.globalState, configService, toolManager);

  // 9c. Workspace-profile association service
  const workspaceProfileService = new WorkspaceProfileService(fileIO, context.globalState);

  // 10. Store services for cross-module access
  services = { configService, registry, toolManager, registryService, workspaceProfileService, outputChannel };

  // 11. Tree view provider
  const treeProvider = new ToolTreeProvider(configService, registry, context.extensionUri);
  treeProvider.register(context);

  // 12. Tree commands (open file, refresh)
  registerToolTreeCommands(context, treeProvider);

  // 13. Management commands (toggle, delete, move, install)
  registerManagementCommands(context, toolManager, treeProvider, profileService);

  // 14. Profile commands (create, switch, edit, delete, save-as, export, import, associate)
  registerProfileCommands(context, profileService, configService, treeProvider, registryService, installService, workspaceProfileService);

  // 14b. Restore active profile name in sidebar header on startup
  const activeId = profileService.getActiveProfileId();
  if (activeId) {
    const activeProfile = profileService.getProfile(activeId);
    treeProvider.setActiveProfile(activeProfile?.name ?? null);
  }

  // 15. Marketplace panel command
  const openMarketplace = vscode.commands.registerCommand(
    'agent-config-keeper.openMarketplace',
    () =>
      MarketplacePanel.createOrShow(
        context.extensionUri,
        registryService,
        configService,
        outputChannel,
        installService,
        toolManager,
      ),
  );
  context.subscriptions.push(openMarketplace);

  // 15b. Config panel command
  const openConfigPanel = vscode.commands.registerCommand(
    'agentConfigKeeper.openConfigPanel',
    () =>
      ConfigPanel.createOrShow(
        context.extensionUri,
        profileService,
        configService,
        toolManager,
        treeProvider,
        outputChannel,
        workspaceProfileService,
      ),
  );
  context.subscriptions.push(openConfigPanel);

  // 16. File watcher for auto-refresh on config changes
  const fileWatcher = new FileWatcherManager(
    () => treeProvider.refresh(),
    () => {
      const showNotif = vscode.workspace
        .getConfiguration('agentConfigKeeper')
        .get<boolean>('showChangeNotifications', true);
      if (showNotif) {
        vscode.window.showInformationMessage('Agent Config Keeper: Config updated');
      }
    },
  );
  context.subscriptions.push(fileWatcher);

  // 16. Auto-detect platform, then setup watchers and initial tree load
  registry
    .detectAndActivate()
    .then((adapter) => {
      if (adapter) {
        outputChannel.appendLine(`Platform detected: ${adapter.displayName}`);
        fileWatcher.setupWatchers(adapter);
        treeProvider.refresh();

        // Auto-activate workspace profile (must run AFTER platform detection completes)
        if (workspaceRoot) {
          handleWorkspaceAutoActivation(
            workspaceRoot,
            profileService,
            workspaceProfileService,
            treeProvider,
            outputChannel,
          ).catch((err: unknown) => {
            outputChannel.appendLine(`Workspace profile auto-activation error: ${err}`);
          });
        }
      } else {
        outputChannel.appendLine('No supported agent platform detected');
      }
    })
    .catch((err: unknown) => {
      outputChannel.appendLine(`Platform detection error: ${err}`);
    });

  // 17. Test command (temporary, for manual verification during development)
  const testCmd = vscode.commands.registerCommand(
    'agent-config-keeper.testReadAll',
    async () => {
      const adapter = registry.getActiveAdapter();
      if (!adapter) {
        vscode.window.showWarningMessage('No agent platform detected');
        return;
      }
      for (const type of adapter.supportedToolTypes) {
        const tools = await configService.readAllTools(type);
        outputChannel.appendLine(`${type}: ${tools.length} tools found`);
        for (const tool of tools) {
          outputChannel.appendLine(
            `  - ${tool.name} [${tool.scope}] ${tool.status}`,
          );
        }
      }
      outputChannel.show();
    },
  );
  context.subscriptions.push(testCmd);

  outputChannel.appendLine('Agent Config Keeper activated');
}

/**
 * Auto-activate the workspace's associated profile after platform detection.
 *
 * Checks the global setting, reads `.vscode/agent-profile.json`, validates
 * that no manual override exists, then switches to the associated profile.
 * Partial activation occurs when some tools are missing (user is prompted
 * to install them from the marketplace).
 */
async function handleWorkspaceAutoActivation(
  workspaceRoot: string,
  profileService: ProfileService,
  workspaceProfileService: WorkspaceProfileService,
  treeProvider: ToolTreeProvider,
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  // 1. Check global setting -- is auto-activation enabled?
  const autoActivate = vscode.workspace
    .getConfiguration('agentConfigKeeper')
    .get<boolean>('autoActivateWorkspaceProfiles', true);
  if (!autoActivate) {
    return;
  }

  // 2. Read .vscode/agent-profile.json
  const association = await workspaceProfileService.getAssociation(workspaceRoot);
  if (!association) {
    return;
  }

  // 3. Check for manual override (validate staleness with current profile names)
  const profileNames = profileService.getProfiles().map((p) => p.name);
  if (workspaceProfileService.isOverridden(workspaceRoot, profileNames)) {
    outputChannel.appendLine(
      `Workspace profile auto-activation skipped: manual override active`,
    );
    return;
  }

  // 4. Find profile by name
  const profile = profileService.getProfiles().find((p) => p.name === association.profileName);
  if (!profile) {
    vscode.window.showWarningMessage(
      `Associated profile "${association.profileName}" not found`,
    );
    return;
  }

  // 5. Switch profile
  const result = await profileService.switchProfile(profile.id);

  // 6. Update sidebar header
  treeProvider.setActiveProfile(profile.name);

  // 7. Show info notification
  vscode.window.showInformationMessage(`Switched to profile: ${profile.name}`);

  // 8. If missing tools, prompt to install
  if (result.skipped > 0) {
    const action = await vscode.window.showWarningMessage(
      `Profile "${profile.name}" has ${result.skipped} missing tool(s).`,
      'Open Marketplace',
    );
    if (action === 'Open Marketplace') {
      await vscode.commands.executeCommand('agent-config-keeper.openMarketplace');
    }
  }
}

export function deactivate(): void {
  services = undefined;
}
