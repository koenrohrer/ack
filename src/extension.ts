import * as vscode from 'vscode';
import { FileIOService } from './services/fileio.service.js';
import { BackupService } from './services/backup.service.js';
import { SchemaService } from './services/schema.service.js';
import { ConfigService } from './services/config.service.js';
import { ProviderRegistry } from './providers/provider.registry.js';
import { resolveCapabilities, DEFAULT_CAPABILITIES } from './types/provider.js';
import type { AgentProvider } from './types/provider.js';
import { decideStartupAgent, agentDetectedKey } from './services/agent-reconcile.utils.js';
import { ClaudeCodeProvider } from './providers/claude-code/claude-code.provider.js';
import { claudeCodeSchemas } from './providers/claude-code/schemas.js';
import { CodexProvider } from './providers/codex/codex.provider.js';
import { codexSchemas } from './providers/codex/schemas.js';
import { CopilotProvider } from './providers/copilot/copilot.provider.js';
import { copilotSchemas } from './providers/copilot/schemas.js';
import { ToolTreeProvider } from './views/tool-tree/tool-tree.provider.js';
import { registerToolTreeCommands } from './views/tool-tree/tool-tree.commands.js';
import { registerManagementCommands } from './views/tool-tree/tool-tree.management.js';
import { registerProfileCommands } from './views/tool-tree/tool-tree.profile-commands.js';
import { ToolManagerService } from './services/tool-manager.service.js';
import { ProfileService } from './services/profile.service.js';
import { FileWatcherManager } from './views/file-watcher.manager.js';
import { ConfigPanel } from './views/config-panel/config-panel.panel.js';
import { WorkspaceProfileService } from './services/workspace-profile.service.js';
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
      registry: ProviderRegistry;
      toolManager: ToolManagerService;
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
  registry: ProviderRegistry;
  toolManager: ToolManagerService;
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
  const backup = new BackupService(fileIO);
  const schemas = new SchemaService();

  // 3. Register schemas
  schemas.registerSchemas(claudeCodeSchemas);
  schemas.registerSchemas(codexSchemas);
  schemas.registerSchemas(copilotSchemas);

  // 4. Workspace root (undefined when no folder is open)
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // 5. Provider setup
  // Register all providers by iterating a single list. Adding a new provider
  // is one array entry — construction, registration, and write-service
  // injection are all driven from here.
  const registry = new ProviderRegistry();
  const providers = [
    new ClaudeCodeProvider(fileIO, schemas, workspaceRoot),
    new CodexProvider(fileIO, schemas, workspaceRoot),
    new CopilotProvider(fileIO, schemas, workspaceRoot, context),
  ];
  for (const provider of providers) {
    registry.register(provider);
  }

  // Register each provider's own commands (the host owns registerCommand).
  for (const a of registry.getAllProviders()) {
    for (const cmd of a.getCommands?.() ?? []) {
      context.subscriptions.push(vscode.commands.registerCommand(cmd.id, cmd.handler));
    }
  }

  // 6. Config service (the main API for reading/writing tool configs)
  const configService = new ConfigService(fileIO, backup, schemas, registry);

  // 6b. Inject write services into providers now that configService exists
  for (const provider of providers) {
    provider.setWriteServices(configService, backup);
  }

  // 7. Tool management service
  const toolManager = new ToolManagerService(configService, registry);

  // 9c. Profile service for named tool presets
  const profileService = new ProfileService(context.globalState, configService, toolManager, registry, fileIO, outputChannel);

  // 9c.1. Run profile migration before any profile operations
  // Migration is fire-and-forget at activation - errors logged but don't block
  profileService.migrateIfNeeded().catch((err: unknown) => {
    outputChannel.appendLine(`Profile migration error: ${err}`);
  });

  // 9d. Workspace-profile association service
  const workspaceProfileService = new WorkspaceProfileService(fileIO, context.globalState);

  // 9e. Agent switcher service (persistence, registry updates, events)
  const agentSwitcher = new AgentSwitcherService(registry, context.globalState);
  context.subscriptions.push(agentSwitcher);

  // 9f. Agent status bar item
  const agentStatusBar = createAgentStatusBar('ack.switchAgent');
  context.subscriptions.push(agentStatusBar);

  // 10. Store services for cross-module access
  services = { configService, registry, toolManager, workspaceProfileService, agentSwitcherService: agentSwitcher, outputChannel };

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
    configService,
    outputChannel,
    registry,
  );

  // 14. Profile commands (create, switch, edit, delete, save-as, export, import, associate, clone-to-agent)
  registerProfileCommands(context, profileService, configService, treeProvider, workspaceProfileService, registry);

  // 14b. Restore active profile name in sidebar header on startup
  const activeId = profileService.getActiveProfileId();
  if (activeId) {
    const activeProfile = profileService.getProfile(activeId);
    treeProvider.setActiveProfile(activeProfile?.name ?? null);
  }

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
        registry.getActiveProvider()?.displayName,
      ),
  );
  context.subscriptions.push(openConfigPanel);

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

  // 15d.1 Activate a specific agent by id (used by the chooser welcome buttons).
  const activateAgentCmd = vscode.commands.registerCommand(
    'ack.activateAgent',
    async (agentId: string) => {
      if (typeof agentId === 'string' && registry.getProvider(agentId)) {
        await agentSwitcher.switchAgent(agentId);
      }
    },
  );
  context.subscriptions.push(activateAgentCmd);

  // 15e. React to agent switches (status bar, file watchers, tree, panels, workspace profiles)
  context.subscriptions.push(
    agentSwitcher.onDidSwitchAgent(async (provider) => {
      await vscode.commands.executeCommand('setContext', 'ack.activeProviderId', provider?.id ?? '');
      // An active agent clears the no-agents / choose-an-agent welcome states.
      if (provider) {
        await vscode.commands.executeCommand('setContext', 'ack.noAgents', false);
        await vscode.commands.executeCommand('setContext', 'ack.chooseAgent', false);
      }
      // Capability context keys drive `when`-clauses without branching on agent id.
      const caps = provider ? resolveCapabilities(provider) : DEFAULT_CAPABILITIES;
      await vscode.commands.executeCommand('setContext', 'ack.cap.mcpEnvVars', caps.mcpEnvVars);
      await vscode.commands.executeCommand('setContext', 'ack.cap.mcpServerToolToggle', caps.mcpServerToolToggle);
      await vscode.commands.executeCommand('setContext', 'ack.cap.customPromptFileInstall', caps.customPromptFileInstall);
      updateAgentStatusBar(agentStatusBar, provider);
      treeProvider.setAgentName(provider?.displayName);
      ConfigPanel.notifyAgentChanged(provider?.displayName ?? 'No Agent');
      if (provider) {
        fileWatcher.setupWatchers(provider);
        treeProvider.refresh();

        // Re-check workspace profile association for the new agent
        if (workspaceRoot) {
          await handleWorkspaceAutoActivation(
            workspaceRoot,
            profileService,
            workspaceProfileService,
            treeProvider,
            outputChannel,
            registry,
          );
        }
      }
    }),
  );

  // Reconcile detected agents into an active selection + welcome context keys.
  // Shared by startup and the re-detect command so both behave identically:
  //   (a) persisted agent still detected -> activate it;
  //   (b) exactly one detected -> activate it;
  //   (c) two or more detected, no usable history -> route to the chooser;
  //   (d) none detected -> the "install an agent" welcome.
  // Returns true iff an agent was activated.
  const applyDetectionResult = async (detected: AgentProvider[]): Promise<boolean> => {
    const detectedIds = detected.map((a) => a.id);

    // Per-agent detection drives the chooser buttons' visibility (and preserves
    // hideWhenUndetected -- an undetected agent never gets a button).
    for (const p of registry.getAllProviders()) {
      await vscode.commands.executeCommand(
        'setContext',
        agentDetectedKey(p.id),
        detectedIds.includes(p.id),
      );
    }

    const decision = decideStartupAgent({
      persistedId: agentSwitcher.getPersistedAgentId(),
      detectedIds,
    });

    if (decision.kind === 'activate') {
      // switchAgent fires onDidSwitchAgent, which clears the welcome keys.
      if (registry.getActiveProvider()?.id !== decision.id) {
        await agentSwitcher.switchAgent(decision.id);
      }
      outputChannel.appendLine(`Active agent: ${registry.getProvider(decision.id)?.displayName ?? decision.id}`);
      return true;
    }

    if (decision.kind === 'choose') {
      await vscode.commands.executeCommand('setContext', 'ack.noAgents', false);
      await vscode.commands.executeCommand('setContext', 'ack.chooseAgent', true);
      outputChannel.appendLine(`Multiple agents detected, awaiting choice: ${detected.map((a) => a.displayName).join(', ')}`);
      return false;
    }

    // none detected
    await vscode.commands.executeCommand('setContext', 'ack.chooseAgent', false);
    await vscode.commands.executeCommand('setContext', 'ack.noAgents', true);
    outputChannel.appendLine('No supported agent platforms detected');
    return false;
  };

  // 15f. Re-detect agents command
  const redetectCmd = vscode.commands.registerCommand(
    'ack.redetectAgents',
    async () => {
      outputChannel.appendLine('Re-detecting agents...');

      // Log individual detection results and collect detected providers
      const detected: AgentProvider[] = [];
      for (const a of registry.getAllProviders()) {
        const found = await a.detect();
        outputChannel.appendLine(`  ${a.displayName}: ${found ? 'detected' : 'not detected'}`);
        if (found) {
          detected.push(a);
        }
      }

      await applyDetectionResult(detected);
      outputChannel.show();

      // Re-run provider configuration checks (force re-surfaces dismissed prompts).
      for (const a of registry.getAllProviders()) {
        await a.checkConfiguration?.(context, true);
      }
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
    // Run detection on all providers
    const detected: AgentProvider[] = [];
    for (const a of registry.getAllProviders()) {
      const found = await a.detect();
      outputChannel.appendLine(`${a.displayName}: ${found ? 'detected' : 'not detected'}`);
      if (found) {
        detected.push(a);
      }
    }

    // Reconcile: last-used-first, else single auto-select, else route to chooser.
    const activated = await applyDetectionResult(detected);

    // Auto-activate workspace profile after successful agent selection
    if (activated && workspaceRoot) {
      await handleWorkspaceAutoActivation(
        workspaceRoot,
        profileService,
        workspaceProfileService,
        treeProvider,
        outputChannel,
        registry,
      );
    }

    // Run provider configuration checks (each provider self-gates on detection).
    for (const a of registry.getAllProviders()) {
      await a.checkConfiguration?.(context);
    }
  })().catch((err: unknown) => {
    outputChannel.appendLine(`Platform detection error: ${err}`);
  });

  // 17. Test command (temporary, for manual verification during development)
  const testCmd = vscode.commands.registerCommand(
    'ack.testReadAll',
    async () => {
      const provider = registry.getActiveProvider();
      if (!provider) {
        vscode.window.showWarningMessage('No agent platform detected');
        return;
      }
      for (const type of provider.supportedToolTypes) {
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
 * Auto-activate the workspace's associated profile after platform detection.
 *
 * Checks the global setting, reads `.vscode/agent-profile.json` filtered by
 * the active agent, validates that no manual override exists, then switches
 * to the associated profile. Partial activation occurs when some tools are
 * missing (those tools are reported and skipped).
 *
 * Agent-scoped: Only activates if the workspace association matches the
 * active agent. Legacy associations (no agentId) are treated as Claude Code.
 */
async function handleWorkspaceAutoActivation(
  workspaceRoot: string,
  profileService: ProfileService,
  workspaceProfileService: WorkspaceProfileService,
  treeProvider: ToolTreeProvider,
  outputChannel: vscode.OutputChannel,
  registry: ProviderRegistry,
): Promise<void> {
  // 1. Check global setting -- is auto-activation enabled?
  const autoActivate = vscode.workspace
    .getConfiguration('ack')
    .get<boolean>('autoActivateWorkspaceProfiles', true);
  if (!autoActivate) {
    return;
  }

  // 2. Get active agent ID
  const activeAgentId = registry.getActiveProvider()?.id;
  if (!activeAgentId) {
    outputChannel.appendLine('Workspace profile auto-activation skipped: no active agent');
    return;
  }

  // 3. Read .vscode/agent-profile.json filtered by active agent
  const association = await workspaceProfileService.getAssociationForAgent(workspaceRoot, activeAgentId);
  if (!association) {
    outputChannel.appendLine(
      `Workspace profile auto-activation skipped: no association for agent ${activeAgentId}`,
    );
    return;
  }

  // 4. Check for manual override (validate staleness with current profile names)
  const profileNames = profileService.getProfiles().map((p) => p.name);
  if (workspaceProfileService.isOverridden(workspaceRoot, profileNames)) {
    outputChannel.appendLine(
      `Workspace profile auto-activation skipped: manual override active`,
    );
    return;
  }

  // 5. Find profile by name (getProfiles() already filters by active agent)
  const profile = profileService.getProfiles().find((p) => p.name === association.profileName);
  if (!profile) {
    vscode.window.showWarningMessage(
      `Associated profile "${association.profileName}" not found for ${activeAgentId}`,
    );
    return;
  }

  // 6. Skip if this profile is already active (prevents re-disabling tools on restart)
  const currentActiveId = profileService.getActiveProfileId();
  if (currentActiveId === profile.id) {
    treeProvider.setActiveProfile(profile.name);
    return;
  }

  // 7. Switch profile
  outputChannel.appendLine(`Auto-activating workspace profile "${profile.name}" for ${activeAgentId}`);
  const result = await profileService.switchProfile(profile.id);

  // 8. Update sidebar header
  treeProvider.setActiveProfile(profile.name);

  // 9. Show info notification
  vscode.window.showInformationMessage(`Switched to profile: ${profile.name}`);

  // 10. If missing tools, report them (local-only; no remote install)
  if (result.skipped > 0) {
    vscode.window.showWarningMessage(
      `Profile "${profile.name}" has ${result.skipped} missing tool(s). Add them via the + on each tool group to enable.`,
    );
  }
}

export function deactivate(): void {
  services = undefined;
}
