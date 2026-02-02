import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import type { ProfileService } from '../../services/profile.service.js';
import type { ConfigService } from '../../services/config.service.js';
import type { ToolManagerService } from '../../services/tool-manager.service.js';
import { ToolType, ConfigScope } from '../../types/enums.js';
import type {
  ConfigPanelWebMessage,
  ConfigPanelExtMessage,
  ProfileInfo,
  ToolInfo,
} from './config-panel.messages.js';

/**
 * Manages the configuration panel webview lifecycle.
 *
 * Singleton pattern: only one config panel exists at a time.
 * State persists across tab hide/show via retainContextWhenHidden.
 */
export class ConfigPanel {
  public static readonly viewType = 'agentConfigKeeper.configPanel';

  private static currentPanel: ConfigPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly profileService: ProfileService;
  private readonly configService: ConfigService;
  private readonly toolManager: ToolManagerService;
  private readonly outputChannel: vscode.OutputChannel;

  /**
   * Create a new config panel or reveal the existing one.
   */
  public static createOrShow(
    extensionUri: vscode.Uri,
    profileService: ProfileService,
    configService: ConfigService,
    toolManager: ToolManagerService,
    outputChannel: vscode.OutputChannel,
  ): void {
    // If panel already exists, reveal it
    if (ConfigPanel.currentPanel) {
      ConfigPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Create new panel
    const panel = vscode.window.createWebviewPanel(
      ConfigPanel.viewType,
      'Configure Agent',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
      },
    );

    ConfigPanel.currentPanel = new ConfigPanel(
      panel,
      extensionUri,
      profileService,
      configService,
      toolManager,
      outputChannel,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    profileService: ProfileService,
    configService: ConfigService,
    toolManager: ToolManagerService,
    outputChannel: vscode.OutputChannel,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.profileService = profileService;
    this.configService = configService;
    this.toolManager = toolManager;
    this.outputChannel = outputChannel;

    // Set initial HTML content
    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      (message: ConfigPanelWebMessage) => this.handleMessage(message),
      undefined,
      this.disposables,
    );

    // Re-send data when panel becomes visible (stale data fix)
    this.panel.onDidChangeViewState(
      () => {
        if (this.panel.visible) {
          void this.sendProfilesData();
          void this.sendToolsData();
        }
      },
      undefined,
      this.disposables,
    );

    // Clean up on dispose
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  /**
   * Handle typed messages from the webview.
   */
  private handleMessage(message: ConfigPanelWebMessage): void {
    switch (message.type) {
      case 'ready':
        void this.sendProfilesData();
        void this.sendToolsData();
        break;
      case 'requestProfiles':
        void this.sendProfilesData();
        break;
      case 'requestTools':
        void this.sendToolsData();
        break;
      case 'createProfile':
        this.outputChannel.appendLine(`[ConfigPanel] TODO: createProfile "${message.name}"`);
        this.postMessage({ type: 'operationError', op: 'createProfile', error: 'Not yet implemented (07-02)' });
        break;
      case 'renameProfile':
        this.outputChannel.appendLine(`[ConfigPanel] TODO: renameProfile ${message.id} -> "${message.name}"`);
        this.postMessage({ type: 'operationError', op: 'renameProfile', error: 'Not yet implemented (07-02)' });
        break;
      case 'deleteProfile':
        this.outputChannel.appendLine(`[ConfigPanel] TODO: deleteProfile ${message.id}`);
        this.postMessage({ type: 'operationError', op: 'deleteProfile', error: 'Not yet implemented (07-02)' });
        break;
      case 'switchProfile':
        this.outputChannel.appendLine(`[ConfigPanel] TODO: switchProfile ${message.id}`);
        this.postMessage({ type: 'operationError', op: 'switchProfile', error: 'Not yet implemented (07-02)' });
        break;
      case 'requestProfileTools':
        this.outputChannel.appendLine(`[ConfigPanel] TODO: requestProfileTools ${message.id}`);
        this.postMessage({ type: 'operationError', op: 'requestProfileTools', error: 'Not yet implemented (07-02)' });
        break;
      case 'updateProfileTools':
        this.outputChannel.appendLine(`[ConfigPanel] TODO: updateProfileTools ${message.id}`);
        this.postMessage({ type: 'operationError', op: 'updateProfileTools', error: 'Not yet implemented (07-02)' });
        break;
      case 'requestMcpSettings':
        this.outputChannel.appendLine(`[ConfigPanel] TODO: requestMcpSettings ${message.toolKey}`);
        this.postMessage({ type: 'operationError', op: 'requestMcpSettings', error: 'Not yet implemented (07-03)' });
        break;
      case 'updateMcpEnv':
        this.outputChannel.appendLine(`[ConfigPanel] TODO: updateMcpEnv ${message.serverName}`);
        this.postMessage({ type: 'operationError', op: 'updateMcpEnv', error: 'Not yet implemented (07-03)' });
        break;
      case 'openToolFile':
        this.outputChannel.appendLine(`[ConfigPanel] TODO: openToolFile ${message.filePath}`);
        this.postMessage({ type: 'operationError', op: 'openToolFile', error: 'Not yet implemented (07-03)' });
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Data senders
  // ---------------------------------------------------------------------------

  /**
   * Send profiles data to webview.
   */
  private async sendProfilesData(): Promise<void> {
    try {
      const profiles = this.profileService.getProfiles();
      const activeId = this.profileService.getActiveProfileId();

      const profileInfos: ProfileInfo[] = profiles.map((p) => ({
        id: p.id,
        name: p.name,
        toolCount: p.tools.length,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }));

      this.postMessage({ type: 'profilesData', profiles: profileInfos, activeId });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load profiles';
      this.outputChannel.appendLine(`[ConfigPanel] Profiles error: ${errorMsg}`);
      this.postMessage({ type: 'operationError', op: 'loadProfiles', error: errorMsg });
    }
  }

  /**
   * Send tools data to webview.
   */
  private async sendToolsData(): Promise<void> {
    try {
      const allTools: ToolInfo[] = [];

      for (const type of Object.values(ToolType)) {
        try {
          const tools = await this.configService.readAllTools(type);
          for (const tool of tools) {
            allTools.push({
              key: tool.id,
              name: tool.name,
              type: tool.type,
              scope: tool.scope,
              status: tool.status,
              isManaged: tool.scope === ConfigScope.Managed,
              hasEditableSettings: tool.type === ToolType.McpServer,
            });
          }
        } catch {
          // Skip types that fail to read
        }
      }

      this.postMessage({ type: 'toolsData', tools: allTools });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load tools';
      this.outputChannel.appendLine(`[ConfigPanel] Tools error: ${errorMsg}`);
      this.postMessage({ type: 'operationError', op: 'loadTools', error: errorMsg });
    }
  }

  // ---------------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------------

  /**
   * Send a typed message to the webview.
   */
  public postMessage(message: ConfigPanelExtMessage): Thenable<boolean> {
    return this.panel.webview.postMessage(message);
  }

  // ---------------------------------------------------------------------------
  // HTML generation
  // ---------------------------------------------------------------------------

  /**
   * Generate the HTML shell for the webview with nonce-based CSP.
   */
  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = crypto.randomUUID();

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'config-panel.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'config-panel.css'),
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
  <title>Configure Agent</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Clean up resources when panel is closed.
   */
  private dispose(): void {
    ConfigPanel.currentPanel = undefined;

    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}
