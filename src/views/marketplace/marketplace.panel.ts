import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import type { RegistryService } from '../../services/registry.service.js';
import type { ConfigService } from '../../services/config.service.js';
import type { InstallService } from '../../services/install.service.js';
import type { ToolManagerService } from '../../services/tool-manager.service.js';
import type { RegistrySource } from '../../services/registry.types.js';
import type { ToolManifest, ConfigField } from '../../services/install.types.js';
import type { GitHubSearchService } from '../../services/github-search.service.js';
import type { GitHubToolType } from '../../services/github-search.types.js';
import { ToolType, ConfigScope } from '../../types/enums.js';
import type {
  WebviewMessage,
  ExtensionMessage,
  RegistryEntryWithSource,
  InstalledToolInfo,
} from './marketplace.messages.js';

/** Normalize a tool name for comparison (lowercased, spaces/underscores → hyphens, .disabled stripped). */
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
  public static readonly viewType = 'agentConfigKeeper.marketplace';

  private static currentPanel: MarketplacePanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly registryService: RegistryService;
  private readonly configService: ConfigService;
  private readonly installService: InstallService;
  private readonly toolManager: ToolManagerService;
  private readonly githubSearch: GitHubSearchService;
  private readonly outputChannel: vscode.OutputChannel;

  /** Cached sources from last fetchAllIndexes, keyed by sourceId. */
  private sourceMap = new Map<string, RegistrySource>();

  /** Cached registry entries from last fetchAllIndexes, keyed by entry id. */
  private toolEntryMap = new Map<string, RegistryEntryWithSource>();

  /** In-progress installs waiting for config form submission, keyed by toolId. */
  private pendingInstalls = new Map<string, PendingInstall>();

  /** Whether GitHub search integration is enabled (defaults ON). */
  private githubEnabled = true;

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
    githubSearch: GitHubSearchService,
  ): void {
    // If panel already exists, reveal it
    if (MarketplacePanel.currentPanel) {
      MarketplacePanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Create new panel
    const panel = vscode.window.createWebviewPanel(
      MarketplacePanel.viewType,
      'Tool Marketplace',
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
      githubSearch,
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
    githubSearch: GitHubSearchService,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.registryService = registryService;
    this.configService = configService;
    this.outputChannel = outputChannel;
    this.installService = installService;
    this.toolManager = toolManager;
    this.githubSearch = githubSearch;

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
        void this.loadRegistryData(false);
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
      case 'searchGitHub':
        void this.loadGitHubResults(message.query, message.typeFilter);
        break;
      case 'requestGitHubReadme':
        void this.loadGitHubReadme(message.repoFullName, message.defaultBranch);
        break;
      case 'authenticateGitHub':
        void this.handleGitHubAuth();
        break;
      case 'toggleGitHub':
        this.githubEnabled = message.enabled;
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
   * Handle requestInstall: fetch manifest, runtime check, scope prompt,
   * conflict detection, config form, or direct install.
   */
  private async handleRequestInstall(
    toolId: string,
    sourceId: string,
  ): Promise<void> {
    this.outputChannel.appendLine(`Install requested for ${toolId}`);

    // a. Look up source
    const source = this.sourceMap.get(sourceId);
    if (!source) {
      this.postMessage({
        type: 'installError',
        toolId,
        error: 'Registry source not found',
      });
      return;
    }

    // b. Look up tool entry from cached registry data to get contentPath
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

    // c. Send downloading progress
    this.postMessage({ type: 'installProgress', toolId, status: 'downloading' });

    try {
      // d. Fetch manifest
      const manifest = await this.installService.getToolManifest(
        source,
        contentPath,
      );

      // e. Runtime pre-check (MCP servers only)
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

      // f. Scope selection
      const scope = await this.promptForScope(manifest.name);
      if (scope === undefined) {
        this.postMessage({ type: 'installCancelled', toolId });
        return;
      }

      // g. Conflict check
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
          // On Update for MCP servers, preserve existing env values
          if (manifest.type === 'mcp_server') {
            const existingEnvValues =
              await this.installService.getExistingEnvValues(
                manifest.name,
                scope,
              );
            // Store for later use in executeInstall
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

      // h. Config form (only if manifest has required configFields)
      if (manifest.configFields && manifest.configFields.length > 0) {
        const hasRequired = manifest.configFields.some((f) => f.required);
        if (hasRequired) {
          // Send config form to webview
          this.postMessage({
            type: 'installConfigRequired',
            toolId,
            fields: manifest.configFields,
          });
          // Store pending context (may already be stored from conflict flow)
          if (!this.pendingInstalls.has(toolId)) {
            this.pendingInstalls.set(toolId, {
              manifest,
              scope,
              source,
              contentPath,
            });
          }
          // Wait for submitConfig message
          return;
        }
        // Optional-only fields: skip form, proceed with defaults
      }

      // i. No required config fields -- proceed directly
      // Check if pending was set from conflict flow
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
      // Find the tool entry to get the name
      const toolEntry = this.toolEntryMap.get(toolId);
      const toolName = toolEntry?.name ?? toolId;

      // Search across all types/scopes for a tool with this name.
      // Use normalized comparison because registry display names ("Test Runner")
      // may differ from installed config names ("test-runner").
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
              // Refresh installed tools and notify webview
              const installedTools = await this.getInstalledTools();
              this.postMessage({
                type: 'installedTools',
                tools: installedTools,
              });
              // Reset install state to idle
              this.postMessage({ type: 'installCancelled', toolId });
              // Refresh sidebar tree
              void vscode.commands.executeCommand(
                'agent-config-keeper.refreshToolTree',
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
   *
   * Sends progress to the webview, calls installService.install(),
   * and handles success/failure with notifications and tree refresh.
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
    // a. Send writing progress
    this.postMessage({ type: 'installProgress', toolId, status: 'writing' });

    // b. Call install service
    const result = await this.installService.install({
      manifest,
      scope,
      source,
      contentPath,
      configValues,
      existingEnvValues,
    });

    if (result.success) {
      // c. Success
      this.postMessage({
        type: 'installComplete',
        toolId,
        scope: scope as string,
      });
      void vscode.window.showInformationMessage(
        `Installed "${manifest.name}" at ${scope} scope`,
      );

      // Refresh installed tools list
      const installedTools = await this.getInstalledTools();
      this.postMessage({ type: 'installedTools', tools: installedTools });

      // Refresh sidebar tree
      void vscode.commands.executeCommand(
        'agent-config-keeper.refreshToolTree',
      );
    } else {
      // d. Failure
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
   *
   * When no workspace is open, only Global is available.
   * Returns undefined if the user dismisses the picker.
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

      // Flatten entries, adding source metadata
      const tools: RegistryEntryWithSource[] = [];
      this.sourceMap.clear();
      this.toolEntryMap.clear();

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
          };
          tools.push(entryWithSource);
          this.toolEntryMap.set(entry.id, entryWithSource);
        }
      }

      // If all sources failed, surface an error instead of an empty list
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

      // Resolve installed tools with type and scope info
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
   * Fetch a tool's README markdown and send to webview.
   */
  private async loadReadme(
    toolId: string,
    sourceId: string,
    readmePath: string,
  ): Promise<void> {
    this.postMessage({ type: 'readmeLoading', toolId });

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

  // ---------------------------------------------------------------------------
  // GitHub search handlers
  // ---------------------------------------------------------------------------

  /**
   * Search GitHub for tools and send results to the webview.
   *
   * Maps GitHubSearchResult[] to RegistryEntryWithSource[] for unified display.
   * Includes relevance scoring for interleaved sort with registry results.
   */
  private async loadGitHubResults(query?: string, typeFilter?: string): Promise<void> {
    this.postMessage({ type: 'githubLoading', loading: true });

    try {
      const results = await this.githubSearch.search({
        query: query || undefined,
        typeFilter: typeFilter as GitHubToolType | undefined,
        maxResults: 30,
      });

      const now = Date.now();
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
      const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

      const mapped: RegistryEntryWithSource[] = results.map((result) => {
        // Recency bonus for relevance scoring
        const updatedAgo = now - new Date(result.lastUpdated).getTime();
        let recencyBonus = 0;
        if (updatedAgo < THIRTY_DAYS_MS) {
          recencyBonus = 20;
        } else if (updatedAgo < NINETY_DAYS_MS) {
          recencyBonus = 10;
        }

        // Map 'profile' to 'command' since profile is not a RegistryEntryWithSource toolType
        const toolType: 'skill' | 'mcp_server' | 'hook' | 'command' =
          result.detectedType === 'profile' ? 'command' : result.detectedType;

        return {
          id: result.id,
          name: result.name,
          toolType,
          description: result.description,
          author: result.author,
          version: '',
          tags: result.topics,
          stars: result.stars,
          installs: 0,
          readmePath: 'README.md',
          contentPath: '',
          createdAt: result.lastUpdated,
          updatedAt: result.lastUpdated,
          sourceId: 'github',
          sourceName: 'GitHub',
          source: 'github' as const,
          repoUrl: result.repoUrl,
          repoFullName: result.repoFullName,
          language: result.language,
          defaultBranch: result.defaultBranch,
          relevanceScore: 50 + Math.log2(result.stars + 1) * 10 + recencyBonus,
        };
      });

      const rateLimitWarning = this.githubSearch.isNearRateLimit()
        ? 'GitHub API rate limit nearly exhausted'
        : undefined;

      this.postMessage({
        type: 'githubResults',
        tools: mapped,
        loading: false,
        rateLimitWarning,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'GitHub search failed';
      this.outputChannel.appendLine(`GitHub search error: ${errorMsg}`);
      this.postMessage({ type: 'githubError', error: errorMsg });
    }
  }

  /**
   * Fetch a GitHub repository's README and send to the webview.
   *
   * Uses the GitHub REST API readme endpoint with raw content accept header.
   * Authenticates via the shared GitHubSearchService auth headers.
   */
  private async loadGitHubReadme(repoFullName: string, _defaultBranch: string): Promise<void> {
    const toolId = `github:${repoFullName}`;
    this.postMessage({ type: 'readmeLoading', toolId });

    try {
      const headers = this.githubSearch.getAuthHeaders();
      headers['Accept'] = 'application/vnd.github.raw';

      const response = await fetch(
        `https://api.github.com/repos/${repoFullName}/readme`,
        { headers },
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const markdown = await response.text();
      this.postMessage({ type: 'readmeData', toolId, markdown });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      this.outputChannel.appendLine(
        `GitHub README fetch error for ${repoFullName}: ${errorMsg}`,
      );
      this.postMessage({
        type: 'readmeData',
        toolId,
        markdown: 'README could not be loaded.',
      });
    }
  }

  /**
   * Handle GitHub authentication request from the webview.
   *
   * Prompts the user via VS Code's GitHub auth provider. On success,
   * refreshes GitHub results to use the authenticated rate limit.
   */
  private async handleGitHubAuth(): Promise<void> {
    const authenticated = await this.githubSearch.promptForAuth();
    if (authenticated) {
      // Refresh with authenticated rate limits
      await this.loadGitHubResults();
    }
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
