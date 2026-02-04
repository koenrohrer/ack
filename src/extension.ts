import * as vscode from 'vscode';
import { FileIOService } from './services/fileio.service.js';
import { BackupService } from './services/backup.service.js';
import { SchemaService } from './services/schema.service.js';
import { ConfigService } from './services/config.service.js';
import { AdapterRegistry } from './adapters/adapter.registry.js';
import { ClaudeCodeAdapter } from './adapters/claude-code/claude-code.adapter.js';
import { claudeCodeSchemas } from './adapters/claude-code/schemas.js';
import { CodexAdapter } from './adapters/codex/codex.adapter.js';
import { codexSchemas } from './adapters/codex/schemas.js';
import { CodexPaths } from './adapters/codex/paths.js';
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
import { RepoScannerService } from './services/repo-scanner.service.js';
import { AgentSwitcherService } from './services/agent-switcher.service.js';
import { showAgentQuickPick } from './views/agent-switcher/agent-switcher.quickpick.js';
import { createAgentStatusBar, updateAgentStatusBar } from './views/agent-switcher/agent-switcher.statusbar.js';

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
      agentSwitcherService: AgentSwitcherService;
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
  agentSwitcherService: AgentSwitcherService;
  outputChannel: vscode.OutputChannel;
} {
  if (!services) {
    throw new Error('Extension not activated');
  }
  return services;
}

export function activate(context: vscode.ExtensionContext): void {
  // 1. Output channel for diagnostics
  const outputChannel = vscode.window.createOutputChannel('ACK');
  context.subscriptions.push(outputChannel);

  // 2. Core services
  const fileIO = new FileIOService();
  const backup = new BackupService();
  const schemas = new SchemaService();

  // 3. Register schemas
  schemas.registerSchemas(claudeCodeSchemas);
  schemas.registerSchemas(codexSchemas);

  // 4. Workspace root (undefined when no folder is open)
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // 5. Adapter setup
  const registry = new AdapterRegistry();
  const claudeAdapter = new ClaudeCodeAdapter(fileIO, schemas, workspaceRoot);
  registry.register(claudeAdapter);
  const codexAdapter = new CodexAdapter(fileIO, schemas, workspaceRoot);
  registry.register(codexAdapter);

  // 6. Config service (the main API for reading/writing tool configs)
  const configService = new ConfigService(fileIO, backup, schemas, registry);

  // 6b. Inject write services into adapters now that configService exists
  claudeAdapter.setWriteServices(configService, backup);
  codexAdapter.setWriteServices(configService, backup);

  // 7. Tool management service
  const toolManager = new ToolManagerService(configService, registry);

  // 8. Registry service for marketplace data
  const registryService = new RegistryService(context);

  // 9. Install service for one-click marketplace installs
  const installService = new InstallService(
    registryService, configService, registry, fileIO, workspaceRoot,
  );

  // 9b. Repo scanner service for marketplace discovery
  const repoScannerService = new RepoScannerService(context.globalState);

  // 9c. Profile service for named tool presets
  const profileService = new ProfileService(context.globalState, configService, toolManager);

  // 9d. Workspace-profile association service
  const workspaceProfileService = new WorkspaceProfileService(fileIO, context.globalState);

  // 9e. Agent switcher service (persistence, registry updates, events)
  const agentSwitcher = new AgentSwitcherService(registry, context.globalState);
  context.subscriptions.push(agentSwitcher);

  // 9f. Agent status bar item
  const agentStatusBar = createAgentStatusBar('ack.switchAgent');
  context.subscriptions.push(agentStatusBar);

  // 10. Store services for cross-module access
  services = { configService, registry, toolManager, registryService, workspaceProfileService, agentSwitcherService: agentSwitcher, outputChannel };

  // 11. Tree view provider
  const treeProvider = new ToolTreeProvider(configService, registry, context.extensionUri);
  treeProvider.register(context);

  // 12. Tree commands (open file, refresh)
  registerToolTreeCommands(context, treeProvider);

  // 13. Management commands (toggle, delete, move, install)
  registerManagementCommands(
    context,
    toolManager,
    treeProvider,
    profileService,
    registryService,
    configService,
    outputChannel,
    installService,
    repoScannerService,
    registry,
  );

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
    'ack.openMarketplace',
    () =>
      MarketplacePanel.createOrShow(
        context.extensionUri,
        registryService,
        configService,
        outputChannel,
        installService,
        toolManager,
        repoScannerService,
        registry,
        undefined, // initialTypeFilter
        registry.getActiveAdapter()?.displayName,
      ),
  );
  context.subscriptions.push(openMarketplace);

  // 15b. Config panel command
  const openConfigPanel = vscode.commands.registerCommand(
    'ack.openConfigPanel',
    () =>
      ConfigPanel.createOrShow(
        context.extensionUri,
        profileService,
        configService,
        toolManager,
        treeProvider,
        outputChannel,
        workspaceProfileService,
        registry,
        registry.getActiveAdapter()?.displayName,
      ),
  );
  context.subscriptions.push(openConfigPanel);

  // 15c. Initialize Codex project command
  const initCodexCmd = vscode.commands.registerCommand(
    'ack.initCodexProject',
    async () => {
      if (!workspaceRoot) {
        vscode.window.showWarningMessage('No workspace folder open');
        return;
      }

      const codexDir = CodexPaths.projectCodexDir(workspaceRoot);
      const configPath = CodexPaths.projectConfigToml(workspaceRoot);
      const promptsDir = CodexPaths.projectPromptsDir(workspaceRoot);
      const skillsDir = CodexPaths.projectSkillsDir(workspaceRoot);

      const { mkdir } = await import('fs/promises');
      await mkdir(promptsDir, { recursive: true });
      await mkdir(skillsDir, { recursive: true });

      // Create config.toml only if it doesn't exist
      const configExists = await fileIO.fileExists(configPath);
      if (!configExists) {
        await fileIO.writeTextFile(configPath, '# Codex project configuration\n');
      }

      outputChannel.appendLine(`Initialized Codex project at ${codexDir}`);
      vscode.window.showInformationMessage(`Initialized Codex project: ${codexDir}`);
    },
  );
  context.subscriptions.push(initCodexCmd);

  // 15d. Switch agent command (status bar click or command palette)
  const switchAgentCmd = vscode.commands.registerCommand(
    'ack.switchAgent',
    async () => {
      const selectedId = await showAgentQuickPick(registry, agentSwitcher.getPersistedAgentId());
      if (selectedId && selectedId !== agentSwitcher.getPersistedAgentId()) {
        await agentSwitcher.switchAgent(selectedId);
      }
    },
  );
  context.subscriptions.push(switchAgentCmd);

  // 15e. React to agent switches (status bar, file watchers, tree, panels)
  context.subscriptions.push(
    agentSwitcher.onDidSwitchAgent((adapter) => {
      updateAgentStatusBar(agentStatusBar, adapter);
      treeProvider.setAgentName(adapter?.displayName);
      MarketplacePanel.notifyAgentChanged(adapter?.displayName ?? 'No Agent');
      ConfigPanel.notifyAgentChanged(adapter?.displayName ?? 'No Agent');
      if (adapter) {
        fileWatcher.setupWatchers(adapter);
        treeProvider.refresh();
      }
    }),
  );

  // 15f. Re-detect agents command
  const redetectCmd = vscode.commands.registerCommand(
    'ack.redetectAgents',
    async () => {
      outputChannel.appendLine('Re-detecting agents...');

      // Log individual detection results and collect detected adapters
      const detected: import('./types/adapter.js').IPlatformAdapter[] = [];
      for (const a of registry.getAllAdapters()) {
        const found = await a.detect();
        outputChannel.appendLine(`  ${a.displayName}: ${found ? 'detected' : 'not detected'}`);
        if (found) {
          detected.push(a);
        }
      }

      if (detected.length === 1) {
        await agentSwitcher.switchAgent(detected[0].id);
        outputChannel.appendLine(`Active agent: ${detected[0].displayName}`);
        vscode.window.showInformationMessage(`Active agent: ${detected[0].displayName}`);
      } else if (detected.length > 1) {
        const currentId = agentSwitcher.getPersistedAgentId();
        const currentStillDetected = currentId && detected.some((a) => a.id === currentId);

        if (currentStillDetected) {
          // Keep current selection
          outputChannel.appendLine(`Multiple agents detected, keeping current: ${currentId}`);
        } else {
          // No current selection or current not detected -- prompt to switch
          outputChannel.appendLine(`Multiple agents detected: ${detected.map((a) => a.displayName).join(', ')}`);
        }

        // Check for newly detected agents and notify
        for (const a of detected) {
          if (a.id !== currentId) {
            const action = await vscode.window.showInformationMessage(
              `${a.displayName} detected`,
              `Switch to ${a.displayName}`,
            );
            if (action) {
              await agentSwitcher.switchAgent(a.id);
            }
          }
        }
      } else {
        outputChannel.appendLine('No agents detected');
        vscode.window.showWarningMessage(
          'No supported agent platforms detected. Install Claude Code or Codex to get started.',
        );
      }
      outputChannel.show();

      // Reset codex config dismissal so re-detection re-checks
      await context.globalState.update('ack.codexConfigDismissed', false);

      // Re-run Codex notifications
      await handleCodexNotifications(context, codexAdapter, fileIO, outputChannel);
    },
  );
  context.subscriptions.push(redetectCmd);

  // 16. File watcher for auto-refresh on config changes
  const fileWatcher = new FileWatcherManager(
    () => treeProvider.refresh(),
    () => {
      const showNotif = vscode.workspace
        .getConfiguration('ack')
        .get<boolean>('showChangeNotifications', true);
      if (showNotif) {
        vscode.window.showInformationMessage('ACK: Config updated');
      }
    },
  );
  context.subscriptions.push(fileWatcher);

  // 16b. Startup detection and agent reconciliation
  (async () => {
    // Run detection on all adapters
    const detected: import('./types/adapter.js').IPlatformAdapter[] = [];
    for (const a of registry.getAllAdapters()) {
      const found = await a.detect();
      outputChannel.appendLine(`${a.displayName}: ${found ? 'detected' : 'not detected'}`);
      if (found) {
        detected.push(a);
      }
    }

    // Reconcile: persisted agent > single auto-select > multiple/zero
    const persistedId = agentSwitcher.getPersistedAgentId();
    let activated = false;

    if (persistedId) {
      const persisted = detected.find((a) => a.id === persistedId);
      if (persisted) {
        await agentSwitcher.switchAgent(persistedId);
        outputChannel.appendLine(`Active agent (restored): ${persisted.displayName}`);
        activated = true;
      } else {
        outputChannel.appendLine(`Previously active agent "${persistedId}" not detected, falling through`);
      }
    }

    if (!activated && detected.length === 1) {
      await agentSwitcher.switchAgent(detected[0].id);
      outputChannel.appendLine(`Active agent: ${detected[0].displayName}`);
      activated = true;
    }

    if (!activated && detected.length > 1) {
      outputChannel.appendLine(`Multiple agents detected: ${detected.map((a) => a.displayName).join(', ')}`);
      vscode.window.showInformationMessage(
        'Multiple agents detected. Use the status bar to select one.',
      );
    }

    if (!activated && detected.length === 0) {
      const msg = 'No supported agent platforms detected. Install Claude Code or Codex to get started.';
      outputChannel.appendLine(msg);
      vscode.window.showInformationMessage(msg);
    }

    // Auto-activate workspace profile after successful agent selection
    if (activated && workspaceRoot) {
      await handleWorkspaceAutoActivation(
        workspaceRoot,
        profileService,
        workspaceProfileService,
        treeProvider,
        outputChannel,
      );
    }

    // Run Codex-specific notifications regardless of which adapter won
    await handleCodexNotifications(context, codexAdapter, fileIO, outputChannel);
  })().catch((err: unknown) => {
    outputChannel.appendLine(`Platform detection error: ${err}`);
  });

  // 17. Test command (temporary, for manual verification during development)
  const testCmd = vscode.commands.registerCommand(
    'ack.testReadAll',
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

  outputChannel.appendLine('ACK activated');
}

/**
 * Handle Codex-specific notifications after detection.
 *
 * When Codex is detected but has no config.toml, offers to create one
 * (with dismissal memory via globalState). When config.toml exists but
 * has TOML parse errors, shows a warning with an "Open File" action.
 */
async function handleCodexNotifications(
  context: vscode.ExtensionContext,
  codexAdapter: CodexAdapter,
  fileIO: FileIOService,
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  const detected = await codexAdapter.detect();
  if (!detected) {
    return;
  }

  // Check if user config.toml exists
  const configExists = await fileIO.fileExists(CodexPaths.userConfigToml);

  if (!configExists) {
    // Check dismissal state
    const dismissed = context.globalState.get<boolean>('ack.codexConfigDismissed', false);
    if (dismissed) {
      return;
    }

    const action = await vscode.window.showInformationMessage(
      'Codex detected but no config.toml found. Create one?',
      'Create Config',
      'Dismiss',
    );

    if (action === 'Create Config') {
      await fileIO.writeTextFile(CodexPaths.userConfigToml, '# Codex user configuration\n');
      outputChannel.appendLine('Created ~/.codex/config.toml');
    } else if (action === 'Dismiss') {
      await context.globalState.update('ack.codexConfigDismissed', true);
    }
    return;
  }

  // Config exists -- check if it's valid TOML
  const readResult = await fileIO.readTomlFile(CodexPaths.userConfigToml);
  if (!readResult.success) {
    const action = await vscode.window.showWarningMessage(
      `Codex config.toml has syntax errors: ${readResult.error}`,
      'Open File',
    );
    if (action === 'Open File') {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(CodexPaths.userConfigToml));
      await vscode.window.showTextDocument(doc);
    }
  }
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
    .getConfiguration('ack')
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

  // 5. Skip if this profile is already active (prevents re-disabling tools on restart)
  const currentActiveId = profileService.getActiveProfileId();
  if (currentActiveId === profile.id) {
    treeProvider.setActiveProfile(profile.name);
    return;
  }

  // 6. Switch profile
  const result = await profileService.switchProfile(profile.id);

  // 7. Update sidebar header
  treeProvider.setActiveProfile(profile.name);

  // 8. Show info notification
  vscode.window.showInformationMessage(`Switched to profile: ${profile.name}`);

  // 9. If missing tools, prompt to install
  if (result.skipped > 0) {
    const action = await vscode.window.showWarningMessage(
      `Profile "${profile.name}" has ${result.skipped} missing tool(s).`,
      'Open Marketplace',
    );
    if (action === 'Open Marketplace') {
      await vscode.commands.executeCommand('ack.openMarketplace');
    }
  }
}

export function deactivate(): void {
  services = undefined;
}
