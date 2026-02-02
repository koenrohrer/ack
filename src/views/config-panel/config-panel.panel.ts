import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import type { ProfileService } from '../../services/profile.service.js';
import type { ConfigService } from '../../services/config.service.js';
import type { ToolManagerService } from '../../services/tool-manager.service.js';
import { ToolType, ConfigScope } from '../../types/enums.js';
import { canonicalKey } from '../../utils/tool-key.utils.js';
import type {
  ConfigPanelWebMessage,
  ConfigPanelExtMessage,
  ProfileInfo,
  ProfileToolInfo,
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
        void this.handleCreateProfile(message.name);
        break;
      case 'renameProfile':
        void this.handleRenameProfile(message.id, message.name);
        break;
      case 'deleteProfile':
        void this.handleDeleteProfile(message.id);
        break;
      case 'switchProfile':
        void this.handleSwitchProfile(message.id);
        break;
      case 'requestProfileTools':
        void this.handleRequestProfileTools(message.id);
        break;
      case 'updateProfileTools':
        void this.handleUpdateProfileTools(message.id, message.tools);
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
  // Profile mutation handlers
  // ---------------------------------------------------------------------------

  /**
   * Create a new profile with an empty tool set.
   *
   * Creates the profile via ProfileService (which auto-snapshots current tools),
   * then immediately clears its tools to produce an empty starting profile.
   */
  private async handleCreateProfile(name: string): Promise<void> {
    try {
      const profile = await this.profileService.createProfile(name);
      // New profiles start empty -- clear the auto-snapshotted tools
      await this.profileService.updateProfile(profile.id, { tools: [] });
      this.outputChannel.appendLine(`[ConfigPanel] Created profile "${name}" (${profile.id})`);
      await this.sendProfilesData();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to create profile';
      this.outputChannel.appendLine(`[ConfigPanel] createProfile error: ${errorMsg}`);
      this.postMessage({ type: 'operationError', op: 'createProfile', error: errorMsg });
    }
  }

  /**
   * Rename an existing profile.
   */
  private async handleRenameProfile(id: string, name: string): Promise<void> {
    try {
      const updated = await this.profileService.updateProfile(id, { name });
      if (!updated) {
        this.postMessage({ type: 'operationError', op: 'renameProfile', error: 'Profile not found' });
        return;
      }
      this.outputChannel.appendLine(`[ConfigPanel] Renamed profile ${id} to "${name}"`);
      await this.sendProfilesData();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to rename profile';
      this.outputChannel.appendLine(`[ConfigPanel] renameProfile error: ${errorMsg}`);
      this.postMessage({ type: 'operationError', op: 'renameProfile', error: errorMsg });
    }
  }

  /**
   * Delete a profile by ID.
   */
  private async handleDeleteProfile(id: string): Promise<void> {
    try {
      const deleted = await this.profileService.deleteProfile(id);
      if (!deleted) {
        this.postMessage({ type: 'operationError', op: 'deleteProfile', error: 'Profile not found' });
        return;
      }
      this.outputChannel.appendLine(`[ConfigPanel] Deleted profile ${id}`);
      await this.sendProfilesData();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to delete profile';
      this.outputChannel.appendLine(`[ConfigPanel] deleteProfile error: ${errorMsg}`);
      this.postMessage({ type: 'operationError', op: 'deleteProfile', error: errorMsg });
    }
  }

  /**
   * Switch to a profile (or deactivate if id is null).
   *
   * Sends profileSwitching to let the UI disable buttons during the operation,
   * then performs the switch and sends the result plus refreshed data.
   */
  private async handleSwitchProfile(id: string | null): Promise<void> {
    try {
      this.postMessage({ type: 'profileSwitching', profileId: id ?? '' });

      const result = await this.profileService.switchProfile(id);

      this.postMessage({
        type: 'profileSwitchComplete',
        result: {
          success: result.success,
          toggled: result.toggled,
          skipped: result.skipped,
          failed: result.failed,
          errors: result.errors,
        },
      });

      this.outputChannel.appendLine(
        `[ConfigPanel] Profile switch ${id ?? 'deactivate'}: ` +
        `toggled=${result.toggled} skipped=${result.skipped} failed=${result.failed}`,
      );

      // Refresh both profiles (active changed) and tools (states changed)
      await this.sendProfilesData();
      await this.sendToolsData();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to switch profile';
      this.outputChannel.appendLine(`[ConfigPanel] switchProfile error: ${errorMsg}`);
      this.postMessage({
        type: 'profileSwitchComplete',
        result: { success: false, toggled: 0, skipped: 0, failed: 0, errors: [errorMsg] },
      });
      this.postMessage({ type: 'operationError', op: 'switchProfile', error: errorMsg });
    }
  }

  /**
   * Load and send tool data for a specific profile.
   *
   * Builds a ProfileToolInfo[] that includes:
   * - All tools in the profile (with their current display info, or marked stale)
   * - All current tools NOT in the profile (with enabled: false) so the user can add them
   */
  private async handleRequestProfileTools(profileId: string): Promise<void> {
    try {
      const profile = this.profileService.getProfile(profileId);
      if (!profile) {
        this.postMessage({ type: 'operationError', op: 'requestProfileTools', error: 'Profile not found' });
        return;
      }

      // Read all current tools across all types
      const currentToolsByKey = new Map<string, { name: string; type: string }>();
      for (const type of Object.values(ToolType)) {
        try {
          const tools = await this.configService.readAllTools(type);
          for (const tool of tools) {
            if (tool.scope === ConfigScope.Managed) {
              continue;
            }
            currentToolsByKey.set(canonicalKey(tool), { name: tool.name, type: tool.type });
          }
        } catch {
          // Skip types that fail to read
        }
      }

      // Build profile tool entries set for quick lookup
      const profileKeySet = new Set(profile.tools.map((e) => e.key));

      const result: ProfileToolInfo[] = [];

      // Add entries from the profile (preserving order)
      for (const entry of profile.tools) {
        const current = currentToolsByKey.get(entry.key);
        if (current) {
          result.push({
            key: entry.key,
            enabled: entry.enabled,
            name: current.name,
            type: current.type,
          });
        } else {
          // Stale entry: tool no longer exists
          // Parse the key to extract a display name
          const parts = entry.key.split(':');
          result.push({
            key: entry.key,
            enabled: entry.enabled,
            name: parts.length > 1 ? parts.slice(1).join(':') + ' (not found)' : entry.key + ' (not found)',
            type: parts[0] ?? 'unknown',
          });
        }
      }

      // Add current tools not yet in the profile (as disabled entries)
      for (const [key, info] of currentToolsByKey) {
        if (!profileKeySet.has(key)) {
          result.push({
            key,
            enabled: false,
            name: info.name,
            type: info.type,
          });
        }
      }

      this.postMessage({ type: 'profileToolsData', profileId, tools: result });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load profile tools';
      this.outputChannel.appendLine(`[ConfigPanel] requestProfileTools error: ${errorMsg}`);
      this.postMessage({ type: 'operationError', op: 'requestProfileTools', error: errorMsg });
    }
  }

  /**
   * Update the tools in a profile.
   *
   * Receives the full tool list from the webview and maps it to ProfileToolEntry[].
   */
  private async handleUpdateProfileTools(
    profileId: string,
    tools: { key: string; enabled: boolean }[],
  ): Promise<void> {
    try {
      const profileToolEntries = tools.map((t) => ({ key: t.key, enabled: t.enabled }));
      const updated = await this.profileService.updateProfile(profileId, { tools: profileToolEntries });
      if (!updated) {
        this.postMessage({ type: 'operationError', op: 'updateProfileTools', error: 'Profile not found' });
        return;
      }

      this.outputChannel.appendLine(
        `[ConfigPanel] Updated profile ${profileId} tools (${profileToolEntries.length} entries)`,
      );

      // Refresh both profile list (toolCount changed) and profile tools
      await this.sendProfilesData();
      await this.handleRequestProfileTools(profileId);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update profile tools';
      this.outputChannel.appendLine(`[ConfigPanel] updateProfileTools error: ${errorMsg}`);
      this.postMessage({ type: 'operationError', op: 'updateProfileTools', error: errorMsg });
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
