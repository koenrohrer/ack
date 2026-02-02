import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import type { RegistryService } from '../../services/registry.service.js';
import type { ConfigService } from '../../services/config.service.js';
import type { RegistrySource } from '../../services/registry.types.js';
import { ToolType } from '../../types/enums.js';
import type {
  WebviewMessage,
  ExtensionMessage,
  RegistryEntryWithSource,
  InstalledToolInfo,
} from './marketplace.messages.js';

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
  private readonly outputChannel: vscode.OutputChannel;

  /** Cached sources from last fetchAllIndexes, keyed by sourceId. */
  private sourceMap = new Map<string, RegistrySource>();

  /**
   * Create a new marketplace panel or reveal the existing one.
   */
  public static createOrShow(
    extensionUri: vscode.Uri,
    registryService: RegistryService,
    configService: ConfigService,
    outputChannel: vscode.OutputChannel,
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
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    registryService: RegistryService,
    configService: ConfigService,
    outputChannel: vscode.OutputChannel,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.registryService = registryService;
    this.configService = configService;
    this.outputChannel = outputChannel;

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
        this.outputChannel.appendLine(
          `Install requested for ${message.toolId}`,
        );
        break;
    }
  }

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

      for (const [sourceId, { source, index }] of allIndexes) {
        this.sourceMap.set(sourceId, source);
        for (const entry of index.tools) {
          tools.push({
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
          });
        }
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

    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}
