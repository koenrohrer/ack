import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import type { WebviewMessage } from './marketplace.messages.js';

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

  /**
   * Create a new marketplace panel or reveal the existing one.
   */
  public static createOrShow(extensionUri: vscode.Uri): void {
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

    MarketplacePanel.currentPanel = new MarketplacePanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

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
        // Webview is ready -- Plan 03 wires real data here
        break;
      case 'requestRegistry':
        // Placeholder -- Plan 03 connects to RegistryService
        break;
      case 'requestReadme':
        // Placeholder -- Plan 03 fetches and renders README
        break;
      case 'requestInstall':
        // Placeholder -- Phase 5 implements install flow
        break;
    }
  }

  /**
   * Send a typed message to the webview.
   */
  public postMessage(message: unknown): Thenable<boolean> {
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
