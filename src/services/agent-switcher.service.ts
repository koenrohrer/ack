import * as vscode from 'vscode';
import type { ProviderRegistry } from '../providers/provider.registry.js';
import type { AgentProvider } from '../types/provider.js';

const ACTIVE_AGENT_KEY = 'ack.activeAgentId';

/**
 * Manages active agent selection, persistence, and switch events.
 *
 * Owns the switching flow: updates the provider registry, persists
 * the selection to globalState, and fires an event for all UI
 * consumers (status bar, tree view, file watchers, webview panels).
 */
export class AgentSwitcherService implements vscode.Disposable {
  private readonly _onDidSwitchAgent = new vscode.EventEmitter<AgentProvider | undefined>();
  readonly onDidSwitchAgent = this._onDidSwitchAgent.event;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly globalState: vscode.Memento,
  ) {}

  /**
   * Read the persisted active agent ID from globalState.
   * Returns undefined if no agent was previously selected.
   */
  getPersistedAgentId(): string | undefined {
    return this.globalState.get<string>(ACTIVE_AGENT_KEY);
  }

  /**
   * Switch to a new agent by ID.
   *
   * Updates the provider registry, persists the selection to globalState,
   * and fires the onDidSwitchAgent event with the new active provider.
   */
  async switchAgent(agentId: string): Promise<void> {
    this.registry.setActiveProvider(agentId);
    await this.globalState.update(ACTIVE_AGENT_KEY, agentId);
    this._onDidSwitchAgent.fire(this.registry.getActiveProvider());
  }

  /**
   * Clear the active agent selection.
   *
   * Removes the persisted agent ID and fires the switch event with
   * undefined. Note: ProviderRegistry has no clearActiveProvider method,
   * so this only clears persistence and fires the event.
   */
  async clearAgent(): Promise<void> {
    await this.globalState.update(ACTIVE_AGENT_KEY, undefined);
    this._onDidSwitchAgent.fire(undefined);
  }

  dispose(): void {
    this._onDidSwitchAgent.dispose();
  }
}
