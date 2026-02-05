import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import type { RegistryService } from '../../services/registry.service.js';
import type { ConfigService } from '../../services/config.service.js';
import type { InstallService } from '../../services/install.service.js';
import type { ToolManagerService } from '../../services/tool-manager.service.js';
import type { RepoScannerService } from '../../services/repo-scanner.service.js';
import type { AdapterRegistry } from '../../adapters/adapter.registry.js';
import type { RegistrySource } from '../../services/registry.types.js';
import type { ToolManifest } from '../../services/install.types.js';
import { ToolType, ConfigScope } from '../../types/enums.js';
import type {
  WebviewMessage,
  ExtensionMessage,
  RegistryEntryWithSource,
  InstalledToolInfo,
  SavedRepoInfo,
} from './marketplace.messages.js';

/** Normalize a tool name for comparison (lowercased, spaces/underscores -> hyphens, .disabled stripped). */
function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/\.disabled$/, '').replace(/[\s_]+/g, '-');
}

/** Map manifest type strings to ToolType enum values. */
const MANIFEST_TYPE_TO_TOOL_TYPE: Record<string, ToolType> = {
  skill: ToolType.Skill,
  mcp_server: ToolType.McpServer,
  hook: ToolType.Hook,
  command: ToolType.Command,
};

/** Settings key for persisted user repositories. */
const USER_REPOS_KEY = 'ack.userRepositories';

/** Pending install context for tools awaiting config form submission. */
interface PendingInstall {
  manifest: ToolManifest;
  scope: ConfigScope;
  source: RegistrySource;
  contentPath: string;
  existingEnvValues?: Record<string, string>;
}

/**
 * Manages the marketplace webview panel lifecycle.
 *
 * Singleton pattern: only one marketplace panel exists at a time.
 * State persists across tab hide/show via retainContextWhenHidden.
 */
export class MarketplacePanel {
  public static readonly viewType = 'ack.marketplace';

  private static currentPanel: MarketplacePanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly registryService: RegistryService;
  private readonly configService: ConfigService;
  private readonly installService: InstallService;
  private readonly toolManager: ToolManagerService;
  private readonly repoScanner: RepoScannerService;
  private readonly registry: AdapterRegistry;
  private readonly outputChannel: vscode.OutputChannel;

  /** Cached sources from last fetchAllIndexes, keyed by sourceId. */
  private sourceMap = new Map<string, RegistrySource>();

  /** Cached registry entries from last fetchAllIndexes, keyed by entry id. */
  private toolEntryMap = new Map<string, RegistryEntryWithSource>();

  /** Type filter to push to webview on first ready message. */
  private initialTypeFilter?: string;

  /** In-progress installs waiting for config form submission, keyed by toolId. */
  private pendingInstalls = new Map<string, PendingInstall>();

  /** User-added repository URLs, persisted in settings. */
  private userRepos: string[] = [];

  /**
   * Notify any open marketplace panel that the active agent changed.
   *
   * Posts an agentChanged message to the webview, updates the panel title,
   * and sends updated agent context (supported tool types and active agent).
   */
  public static notifyAgentChanged(agentName: string): void {
    if (!MarketplacePanel.currentPanel) {
      return;
    }
    MarketplacePanel.currentPanel.postMessage({ type: 'agentChanged', agentName });
    MarketplacePanel.currentPanel.panel.title = `Tool Marketplace - ${agentName}`;
    MarketplacePanel.currentPanel.sendAgentContext();
  }

  /**
   * Create a new marketplace panel or reveal the existing one.
   */
  public static createOrShow(
    extensionUri: vscode.Uri,
    registryService: RegistryService,
    configService: ConfigService,
    outputChannel: vscode.OutputChannel,
    installService: InstallService,
    toolManager: ToolManagerService,
    repoScanner: RepoScannerService,
    registry: AdapterRegistry,
    initialTypeFilter?: string,
    agentName?: string,
  ): void {
    // If panel already exists, reveal it and optionally re-filter
    if (MarketplacePanel.currentPanel) {
      MarketplacePanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      if (initialTypeFilter) {
        MarketplacePanel.currentPanel.postMessage({
          type: 'setTypeFilter',
          filter: initialTypeFilter,
        });
      }
      return;
    }

    // Create new panel
    const panelTitle = agentName ? `Tool Marketplace - ${agentName}` : 'Tool Marketplace';
    const panel = vscode.window.createWebviewPanel(
      MarketplacePanel.viewType,
      panelTitle,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
      },
    );

    MarketplacePanel.currentPanel = new MarketplacePanel(
      panel,
      extensionUri,
      registryService,
      configService,
      outputChannel,
      installService,
      toolManager,
      repoScanner,
      registry,
      initialTypeFilter,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    registryService: RegistryService,
    configService: ConfigService,
    outputChannel: vscode.OutputChannel,
    installService: InstallService,
    toolManager: ToolManagerService,
    repoScanner: RepoScannerService,
    registry: AdapterRegistry,
    initialTypeFilter?: string,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.registryService = registryService;
    this.configService = configService;
    this.outputChannel = outputChannel;
    this.installService = installService;
    this.toolManager = toolManager;
    this.repoScanner = repoScanner;
    this.registry = registry;
    this.initialTypeFilter = initialTypeFilter;

    // Load saved repos from settings
    this.userRepos = vscode.workspace
      .getConfiguration()
      .get<string[]>(USER_REPOS_KEY, []);

    // Set initial HTML content
    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleMessage(message),
      undefined,
      this.disposables,
    );

    // Clean up on dispose
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  /**
   * Handle typed messages from the webview.
   */
  private handleMessage(message: WebviewMessage): void {
    switch (message.type) {
      case 'ready':
        if (this.initialTypeFilter) {
          this.postMessage({
            type: 'setTypeFilter',
            filter: this.initialTypeFilter,
          });
          this.initialTypeFilter = undefined;
        }
        void this.loadRegistryData(false);
        void this.loadRepoTools();
        this.sendAgentContext();
        break;
      case 'requestRegistry':
        void this.loadRegistryData(message.forceRefresh ?? false);
        break;
      case 'requestReadme':
        void this.loadReadme(
          message.toolId,
          message.sourceId,
          message.readmePath,
        );
        break;
      case 'requestInstall':
        void this.handleRequestInstall(message.toolId, message.sourceId);
        break;
      case 'submitConfig':
        void this.handleSubmitConfig(message.toolId, message.values);
        break;
      case 'retryInstall':
        void this.handleRequestInstall(message.toolId, message.sourceId);
        break;
      case 'requestUninstall':
        void this.handleRequestUninstall(message.toolId);
        break;
      case 'addRepo':
        void this.handleAddRepo(message.url);
        break;
      case 'removeRepo':
        void this.handleRemoveRepo(message.url);
        break;
      case 'refreshRepo':
        void this.handleRefreshRepo(message.url);
        break;
      case 'openExternal':
        void vscode.env.openExternal(vscode.Uri.parse(message.url));
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Install flow handlers
  // ---------------------------------------------------------------------------

  /**
   * Handle requestInstall: route to repo install or registry install.
   */
  private async handleRequestInstall(
    toolId: string,
    sourceId: string,
  ): Promise<void> {
    this.outputChannel.appendLine(`Install requested for ${toolId}`);

    if (sourceId === 'repo') {
      await this.handleRepoInstall(toolId);
      return;
    }

    // Registry install flow
    const source = this.sourceMap.get(sourceId);
    if (!source) {
      this.postMessage({
        type: 'installError',
        toolId,
        error: 'Registry source not found',
      });
      return;
    }

    const toolEntry = this.toolEntryMap.get(toolId);
    if (!toolEntry) {
      this.postMessage({
        type: 'installError',
        toolId,
        error: 'Tool not found in registry cache',
      });
      return;
    }
    const contentPath = toolEntry.contentPath;

    this.postMessage({ type: 'installProgress', toolId, status: 'downloading' });

    try {
      const manifest = await this.installService.getToolManifest(
        source,
        contentPath,
      );

      if (manifest.type === 'mcp_server' && manifest.runtime) {
        const runtimeResult = await this.installService.checkRuntime(
          manifest.runtime,
        );
        if (!runtimeResult.available) {
          const choice = await vscode.window.showWarningMessage(
            `Runtime "${manifest.runtime}" not found on your system. The tool may not work correctly.`,
            'Install Anyway',
            'Cancel',
          );
          if (choice !== 'Install Anyway') {
            this.postMessage({ type: 'installCancelled', toolId });
            return;
          }
        }
      }

      const scope = await this.promptForScope(manifest.name);
      if (scope === undefined) {
        this.postMessage({ type: 'installCancelled', toolId });
        return;
      }

      const toolType = MANIFEST_TYPE_TO_TOOL_TYPE[manifest.type];
      if (toolType) {
        const hasConflict = await this.installService.checkConflict(
          manifest.name,
          manifest.type,
          scope,
        );
        if (hasConflict) {
          const conflictChoice = await vscode.window.showWarningMessage(
            `"${manifest.name}" already exists at ${scope} scope.`,
            'Update',
            'Cancel',
          );
          if (conflictChoice !== 'Update') {
            this.postMessage({ type: 'installCancelled', toolId });
            return;
          }
          if (manifest.type === 'mcp_server') {
            const existingEnvValues =
              await this.installService.getExistingEnvValues(
                manifest.name,
                scope,
              );
            this.pendingInstalls.set(toolId, {
              manifest,
              scope,
              source,
              contentPath,
              existingEnvValues,
            });
          }
        }
      }

      if (manifest.configFields && manifest.configFields.length > 0) {
        const hasRequired = manifest.configFields.some((f) => f.required);
        if (hasRequired) {
          this.postMessage({
            type: 'installConfigRequired',
            toolId,
            fields: manifest.configFields,
          });
          if (!this.pendingInstalls.has(toolId)) {
            this.pendingInstalls.set(toolId, {
              manifest,
              scope,
              source,
              contentPath,
            });
          }
          return;
        }
      }

      const pendingFromConflict = this.pendingInstalls.get(toolId);
      if (pendingFromConflict) {
        this.pendingInstalls.delete(toolId);
        await this.executeInstall(
          toolId,
          pendingFromConflict.manifest,
          pendingFromConflict.scope,
          pendingFromConflict.source,
          pendingFromConflict.contentPath,
          undefined,
          pendingFromConflict.existingEnvValues,
        );
      } else {
        await this.executeInstall(
          toolId,
          manifest,
          scope,
          source,
          contentPath,
        );
      }
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : 'Install failed';
      this.outputChannel.appendLine(`Install error for ${toolId}: ${errorMsg}`);
      this.postMessage({ type: 'installError', toolId, error: errorMsg });
    }
  }

  /**
   * Handle install for repo-sourced tools.
   *
   * For skills: fetch files from raw.githubusercontent.com, write to skills dir.
   * For commands: fetch .md file, write to commands dir.
   * For MCP: fetch .mcp.json, parse, add server via writer.
   */
  private async handleRepoInstall(toolId: string): Promise<void> {
    const toolEntry = this.toolEntryMap.get(toolId);
    if (!toolEntry || !toolEntry.repoFullName || !toolEntry.defaultBranch) {
      this.postMessage({
        type: 'installError',
        toolId,
        error: 'Repo tool metadata missing',
      });
      return;
    }

    const scope = await this.promptForScope(toolEntry.name);
    if (scope === undefined) {
      this.postMessage({ type: 'installCancelled', toolId });
      return;
    }

    this.postMessage({ type: 'installProgress', toolId, status: 'downloading' });

    try {
      const adapter = this.getAdapter();
      const { repoFullName, defaultBranch, repoPath, repoFiles } = toolEntry;

      if (toolEntry.toolType === 'skill') {
        // Fetch files from repo, then delegate to adapter
        const files = repoFiles && repoFiles.length > 0
          ? repoFiles
          : [repoPath!];
        const fileContents: Array<{ name: string; content: string }> = [];
        for (const filePath of files) {
          const content = await this.repoScanner.fetchRepoFile(
            repoFullName!,
            defaultBranch!,
            filePath,
          );
          const fileName = filePath.split('/').pop()!;
          fileContents.push({ name: fileName, content });
        }
        await adapter.installSkill(scope, toolEntry.name, fileContents);
      } else if (toolEntry.toolType === 'command') {
        const content = await this.repoScanner.fetchRepoFile(
          repoFullName!,
          defaultBranch!,
          repoPath!,
        );
        const fileName = repoPath!.split('/').pop()!;
        await adapter.installCommand(scope, toolEntry.name, [{ name: fileName, content }]);
      } else if (toolEntry.toolType === 'mcp_server') {
        const content = await this.repoScanner.fetchRepoFile(
          repoFullName!,
          defaultBranch!,
          repoPath!,
        );
        const mcpConfig = JSON.parse(content) as {
          mcpServers?: Record<string, unknown>;
        };

        if (mcpConfig.mcpServers) {
          for (const [serverName, serverConfig] of Object.entries(
            mcpConfig.mcpServers,
          )) {
            await adapter.installMcpServer(
              scope,
              serverName,
              serverConfig as Record<string, unknown>,
            );
          }
        }
      }

      this.postMessage({
        type: 'installComplete',
        toolId,
        scope: scope as string,
      });
      void vscode.window.showInformationMessage(
        `Installed "${toolEntry.name}" at ${scope} scope`,
      );

      const installedTools = await this.getInstalledTools();
      this.postMessage({ type: 'installedTools', tools: installedTools });
      void vscode.commands.executeCommand(
        'ack.refreshToolTree',
      );
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Install failed';
      this.outputChannel.appendLine(
        `Repo install error for ${toolId}: ${errorMsg}`,
      );
      this.postMessage({ type: 'installError', toolId, error: errorMsg });
    }
  }

  /**
   * Handle submitConfig: retrieve pending context and execute install.
   */
  private async handleSubmitConfig(
    toolId: string,
    configValues: Record<string, string>,
  ): Promise<void> {
    const pending = this.pendingInstalls.get(toolId);
    if (!pending) {
      this.postMessage({
        type: 'installError',
        toolId,
        error: 'No pending install found for this tool',
      });
      return;
    }

    this.pendingInstalls.delete(toolId);

    try {
      await this.executeInstall(
        toolId,
        pending.manifest,
        pending.scope,
        pending.source,
        pending.contentPath,
        configValues,
        pending.existingEnvValues,
      );
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : 'Install failed';
      this.outputChannel.appendLine(`Install error for ${toolId}: ${errorMsg}`);
      this.postMessage({ type: 'installError', toolId, error: errorMsg });
    }
  }

  /**
   * Handle requestUninstall: find the installed tool by name and remove it.
   */
  private async handleRequestUninstall(toolId: string): Promise<void> {
    this.outputChannel.appendLine(`Uninstall requested for ${toolId}`);

    try {
      const toolEntry = this.toolEntryMap.get(toolId);
      const toolName = toolEntry?.name ?? toolId;

      const normalizedTarget = normalizeToolName(toolName);
      let found = false;
      for (const type of Object.values(ToolType)) {
        try {
          const tools = await this.configService.readAllTools(type);
          const match = tools.find(
            (t) => normalizeToolName(t.name) === normalizedTarget,
          );
          if (match) {
            const result = await this.toolManager.deleteTool(match);
            if (result.success) {
              found = true;
              void vscode.window.showInformationMessage(
                `Uninstalled "${toolName}"`,
              );
              const installedTools = await this.getInstalledTools();
              this.postMessage({
                type: 'installedTools',
                tools: installedTools,
              });
              this.postMessage({ type: 'installCancelled', toolId });
              void vscode.commands.executeCommand(
                'ack.refreshToolTree',
              );
            } else {
              void vscode.window.showErrorMessage(
                `Failed to uninstall "${toolName}": ${result.error}`,
              );
              this.postMessage({
                type: 'installError',
                toolId,
                error: result.error,
              });
            }
            break;
          }
        } catch {
          // Skip types that fail to read
        }
      }

      if (!found) {
        void vscode.window.showErrorMessage(
          `Tool "${toolName}" not found in any configuration`,
        );
        this.postMessage({
          type: 'installError',
          toolId,
          error: 'Tool not found in configuration',
        });
      }
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : 'Uninstall failed';
      this.outputChannel.appendLine(
        `Uninstall error for ${toolId}: ${errorMsg}`,
      );
      void vscode.window.showErrorMessage(`Uninstall failed: ${errorMsg}`);
      this.postMessage({ type: 'installError', toolId, error: errorMsg });
    }
  }

  /**
   * Execute the actual install via InstallService.
   */
  private async executeInstall(
    toolId: string,
    manifest: ToolManifest,
    scope: ConfigScope,
    source: RegistrySource,
    contentPath: string,
    configValues?: Record<string, string>,
    existingEnvValues?: Record<string, string>,
  ): Promise<void> {
    this.postMessage({ type: 'installProgress', toolId, status: 'writing' });

    const result = await this.installService.install({
      manifest,
      scope,
      source,
      contentPath,
      configValues,
      existingEnvValues,
    });

    if (result.success) {
      this.postMessage({
        type: 'installComplete',
        toolId,
        scope: scope as string,
      });
      void vscode.window.showInformationMessage(
        `Installed "${manifest.name}" at ${scope} scope`,
      );

      const installedTools = await this.getInstalledTools();
      this.postMessage({ type: 'installedTools', tools: installedTools });

      void vscode.commands.executeCommand(
        'ack.refreshToolTree',
      );
    } else {
      this.outputChannel.appendLine(
        `Install failed for ${toolId}: ${result.error}`,
      );
      this.postMessage({
        type: 'installError',
        toolId,
        error: result.error ?? 'Unknown error',
      });
      const action = await vscode.window.showErrorMessage(
        `Failed to install "${manifest.name}": ${result.error}`,
        'Show Output',
      );
      if (action === 'Show Output') {
        this.outputChannel.show();
      }
    }
  }

  /**
   * Prompt the user to select a scope (Global / Project).
   */
  private async promptForScope(
    toolName: string,
  ): Promise<ConfigScope | undefined> {
    const hasWorkspace =
      vscode.workspace.workspaceFolders !== undefined &&
      vscode.workspace.workspaceFolders.length > 0;

    const items: vscode.QuickPickItem[] = [
      {
        label: 'Global',
        description: 'Available in all projects (~/.claude)',
      },
    ];

    if (hasWorkspace) {
      items.push({
        label: 'Project',
        description: 'Available only in this workspace (.claude/)',
      });
    }

    const pick = await vscode.window.showQuickPick(items, {
      title: `Install "${toolName}" -- select scope`,
      placeHolder: hasWorkspace
        ? 'Choose where to install'
        : '(Project scope requires an open workspace)',
    });

    if (!pick) {
      return undefined;
    }

    return pick.label === 'Global' ? ConfigScope.User : ConfigScope.Project;
  }

  // ---------------------------------------------------------------------------
  // Adapter access
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

  // ---------------------------------------------------------------------------
  // Repository handlers
  // ---------------------------------------------------------------------------

  /**
   * Handle addRepo: validate URL, scan repo, save to settings, send tools.
   */
  private async handleAddRepo(url: string): Promise<void> {
    const parsed = this.repoScanner.parseRepoUrl(url);
    if (!parsed) {
      this.postMessage({
        type: 'repoScanError',
        repoUrl: url,
        error: 'Invalid GitHub repository URL',
      });
      return;
    }

    // Normalize to canonical URL
    const canonicalUrl = `https://github.com/${parsed.owner}/${parsed.repo}`;

    // Check for duplicate
    if (this.userRepos.includes(canonicalUrl)) {
      this.postMessage({
        type: 'repoScanError',
        repoUrl: canonicalUrl,
        error: 'Repository already added',
      });
      return;
    }

    this.postMessage({ type: 'repoScanLoading', repoUrl: canonicalUrl });

    const result = await this.repoScanner.scanRepo(canonicalUrl);

    if (result.error) {
      this.postMessage({
        type: 'repoScanError',
        repoUrl: canonicalUrl,
        error: result.error,
      });
      return;
    }

    // Save to settings
    this.userRepos.push(canonicalUrl);
    await vscode.workspace
      .getConfiguration()
      .update(USER_REPOS_KEY, this.userRepos, vscode.ConfigurationTarget.Global);

    this.postMessage({ type: 'repoScanComplete', repoUrl: canonicalUrl });

    // Send updated tools and repo list
    await this.sendRepoState();
  }

  /**
   * Handle removeRepo: remove from settings, clear cache, send updated state.
   */
  private async handleRemoveRepo(url: string): Promise<void> {
    this.userRepos = this.userRepos.filter((r) => r !== url);
    await vscode.workspace
      .getConfiguration()
      .update(USER_REPOS_KEY, this.userRepos, vscode.ConfigurationTarget.Global);

    this.repoScanner.removeCachedScan(url);
    this.postMessage({ type: 'repoRemoved', repoUrl: url });
    await this.sendRepoState();
  }

  /**
   * Handle refreshRepo: re-scan and send updated tools.
   */
  private async handleRefreshRepo(url: string): Promise<void> {
    this.postMessage({ type: 'repoScanLoading', repoUrl: url });

    this.repoScanner.removeCachedScan(url);
    const result = await this.repoScanner.scanRepo(url);

    if (result.error) {
      this.postMessage({
        type: 'repoScanError',
        repoUrl: url,
        error: result.error,
      });
      return;
    }

    this.postMessage({ type: 'repoScanComplete', repoUrl: url });
    await this.sendRepoState();
  }

  // ---------------------------------------------------------------------------
  // Registry data loading
  // ---------------------------------------------------------------------------

  /**
   * Fetch all registry indexes, flatten into RegistryEntryWithSource[],
   * resolve installed tool IDs, and send to webview.
   */
  private async loadRegistryData(forceRefresh: boolean): Promise<void> {
    this.postMessage({ type: 'registryLoading', loading: true });

    try {
      const allIndexes =
        await this.registryService.fetchAllIndexes(forceRefresh);

      const tools: RegistryEntryWithSource[] = [];
      this.sourceMap.clear();
      // Don't clear toolEntryMap fully; repo entries may already be there.
      // We'll remove registry entries and re-add them.
      for (const [key, entry] of this.toolEntryMap) {
        if (entry.source !== 'repo') {
          this.toolEntryMap.delete(key);
        }
      }

      for (const [sourceId, { source, index }] of allIndexes) {
        this.sourceMap.set(sourceId, source);
        for (const entry of index.tools) {
          const entryWithSource: RegistryEntryWithSource = {
            id: entry.id,
            name: entry.name,
            toolType: entry.type,
            description: entry.description,
            author: entry.author,
            version: entry.version,
            tags: entry.tags,
            stars: entry.stars,
            installs: entry.installs,
            readmePath: entry.readmePath,
            contentPath: entry.contentPath,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            sourceId,
            sourceName: source.name,
            source: 'registry' as const,
            relevanceScore: 100 + Math.log2(entry.stars + 1) * 10 + Math.log2(entry.installs + 1) * 5,
            agents: entry.agents ?? [],
          };
          tools.push(entryWithSource);
          this.toolEntryMap.set(entry.id, entryWithSource);
        }
      }

      if (allIndexes.size === 0) {
        this.outputChannel.appendLine(
          'Registry fetch: all sources returned empty or failed',
        );
        this.postMessage({
          type: 'registryError',
          error:
            'No registry sources responded. Check your network connection or registry configuration.',
        });
        return;
      }

      const installedTools = await this.getInstalledTools();

      this.postMessage({ type: 'installedTools', tools: installedTools });
      this.postMessage({ type: 'registryData', tools, loading: false });
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : 'Failed to load registry';
      this.outputChannel.appendLine(`Registry fetch error: ${errorMsg}`);
      this.postMessage({ type: 'registryError', error: errorMsg });
    }
  }

  /**
   * Load repo tools from all saved repos (cache-first) and send to webview.
   */
  private async loadRepoTools(): Promise<void> {
    // Send saved repos list immediately
    this.sendSavedRepos();

    if (this.userRepos.length === 0) {
      this.postMessage({ type: 'repoTools', tools: [] });
      return;
    }

    const allTools: RegistryEntryWithSource[] = [];

    for (const url of this.userRepos) {
      // Use cache first
      let result = this.repoScanner.getCachedScan(url);
      if (!result) {
        this.postMessage({ type: 'repoScanLoading', repoUrl: url });
        result = await this.repoScanner.scanRepo(url);
        if (result.error) {
          this.postMessage({
            type: 'repoScanError',
            repoUrl: url,
            error: result.error,
          });
          continue;
        }
        this.postMessage({ type: 'repoScanComplete', repoUrl: url });
      }

      for (const tool of result.tools) {
        const entry = this.mapScannedToolToEntry(tool);
        allTools.push(entry);
        this.toolEntryMap.set(entry.id, entry);
      }
    }

    this.postMessage({ type: 'repoTools', tools: allTools });
    this.sendSavedRepos();
  }

  /**
   * Send updated repo tools and saved repos list to webview.
   */
  private async sendRepoState(): Promise<void> {
    const allTools: RegistryEntryWithSource[] = [];

    // Clear repo entries from toolEntryMap
    for (const [key, entry] of this.toolEntryMap) {
      if (entry.source === 'repo') {
        this.toolEntryMap.delete(key);
      }
    }

    for (const url of this.userRepos) {
      const result = this.repoScanner.getCachedScan(url);
      if (!result) continue;

      for (const tool of result.tools) {
        const entry = this.mapScannedToolToEntry(tool);
        allTools.push(entry);
        this.toolEntryMap.set(entry.id, entry);
      }
    }

    this.postMessage({ type: 'repoTools', tools: allTools });
    this.sendSavedRepos();
  }

  /**
   * Map a ScannedTool to RegistryEntryWithSource for unified display.
   */
  private mapScannedToolToEntry(tool: import('../../services/repo-scanner.types.js').ScannedTool): RegistryEntryWithSource {
    return {
      id: tool.id,
      name: tool.name,
      toolType: tool.toolType,
      description: tool.description,
      author: tool.author,
      version: '',
      tags: [],
      stars: 0,
      installs: 0,
      readmePath: 'README.md',
      contentPath: '',
      createdAt: '',
      updatedAt: '',
      sourceId: 'repo',
      sourceName: tool.repoFullName,
      source: 'repo' as const,
      repoUrl: tool.repoUrl,
      repoFullName: tool.repoFullName,
      defaultBranch: tool.defaultBranch,
      repoPath: tool.repoPath,
      repoFiles: tool.files,
      relevanceScore: 50,
    };
  }

  /**
   * Send the current saved repos list to the webview.
   */
  private sendSavedRepos(): void {
    const repos: SavedRepoInfo[] = this.userRepos.map((url) => {
      const cached = this.repoScanner.getCachedScan(url);
      return {
        url,
        repoFullName: cached?.repoFullName ?? url.replace('https://github.com/', ''),
        toolCount: cached?.tools.length ?? 0,
      };
    });
    this.postMessage({ type: 'savedRepos', repos });
  }

  /**
   * Fetch a tool's README markdown and send to webview.
   */
  private async loadReadme(
    toolId: string,
    sourceId: string,
    readmePath: string,
  ): Promise<void> {
    this.postMessage({ type: 'readmeLoading', toolId });

    if (sourceId === 'repo') {
      await this.loadRepoReadme(toolId);
      return;
    }

    const source = this.sourceMap.get(sourceId);
    if (!source) {
      this.postMessage({
        type: 'readmeData',
        toolId,
        markdown: 'Source not found.',
      });
      return;
    }

    const markdown = await this.registryService.fetchReadme(
      source,
      readmePath,
    );
    this.postMessage({ type: 'readmeData', toolId, markdown });
  }

  /**
   * Fetch the tool's own content file for the detail view.
   *
   * Uses the tool's repoPath (e.g. skills/my-skill/SKILL.md) rather
   * than the repo-level README.md.
   */
  private async loadRepoReadme(toolId: string): Promise<void> {
    const toolEntry = this.toolEntryMap.get(toolId);
    if (!toolEntry?.repoFullName || !toolEntry.defaultBranch || !toolEntry.repoPath) {
      this.postMessage({
        type: 'readmeData',
        toolId,
        markdown: 'No content available.',
      });
      return;
    }

    try {
      const markdown = await this.repoScanner.fetchRepoFile(
        toolEntry.repoFullName,
        toolEntry.defaultBranch,
        toolEntry.repoPath,
      );
      this.postMessage({ type: 'readmeData', toolId, markdown });
    } catch {
      this.postMessage({
        type: 'readmeData',
        toolId,
        markdown: 'Content could not be loaded.',
      });
    }
  }

  /**
   * Send current agent context (supported tool types and active agent) to webview.
   */
  private sendAgentContext(): void {
    const adapter = this.registry.getActiveAdapter();
    if (!adapter) {
      return;
    }

    // Send supported tool types as string array
    const types = Array.from(adapter.supportedToolTypes).map((t) => t as string);
    this.postMessage({ type: 'supportedToolTypes', types });

    // Send active agent info
    this.postMessage({
      type: 'activeAgent',
      agentId: adapter.id,
      displayName: adapter.displayName,
    });
  }

  /**
   * Collect installed tool info (name, type, scope) across all types.
   */
  private async getInstalledTools(): Promise<InstalledToolInfo[]> {
    const result: InstalledToolInfo[] = [];
    for (const type of Object.values(ToolType)) {
      try {
        const tools = await this.configService.readAllTools(type);
        for (const tool of tools) {
          result.push({
            name: tool.name,
            type: tool.type,
            scope: tool.scope,
          });
        }
      } catch {
        // Skip types that fail to read
      }
    }
    return result;
  }

  /**
   * Send a typed message to the webview.
   */
  public postMessage(message: ExtensionMessage): Thenable<boolean> {
    return this.panel.webview.postMessage(message);
  }

  /**
   * Generate the HTML shell for the webview with nonce-based CSP.
   */
  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = crypto.randomUUID();

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.css'),
    );

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
      style-src ${webview.cspSource} 'unsafe-inline';
      script-src 'nonce-${nonce}';
      font-src ${webview.cspSource};
      img-src ${webview.cspSource} https:;">
  <link rel="stylesheet" href="${styleUri}">
  <title>Tool Marketplace</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  /**
   * Clean up resources when panel is closed.
   */
  private dispose(): void {
    MarketplacePanel.currentPanel = undefined;
    this.pendingInstalls.clear();

    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}
