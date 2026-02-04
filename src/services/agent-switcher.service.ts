import * as vscode from 'vscode';
import type { AdapterRegistry } from '../adapters/adapter.registry.js';
import type { IPlatformAdapter } from '../types/adapter.js';

const ACTIVE_AGENT_KEY = 'ack.activeAgentId';

/**
 * Manages active agent selection, persistence, and switch events.
 *
 * Owns the switching flow: updates the adapter registry, persists
 * the selection to globalState, and fires an event for all UI
 * consumers (status bar, tree view, file watchers, webview panels).
 */
export class AgentSwitcherService implements vscode.Disposable {
  private readonly _onDidSwitchAgent = new vscode.EventEmitter<IPlatformAdapter | undefined>();
  readonly onDidSwitchAgent = this._onDidSwitchAgent.event;

  constructor(
    private readonly registry: AdapterRegistry,
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
   * Updates the adapter registry, persists the selection to globalState,
   * and fires the onDidSwitchAgent event with the new active adapter.
   */
  async switchAgent(agentId: string): Promise<void> {
    this.registry.setActiveAdapter(agentId);
    await this.globalState.update(ACTIVE_AGENT_KEY, agentId);
    this._onDidSwitchAgent.fire(this.registry.getActiveAdapter());
  }

  /**
   * Clear the active agent selection.
   *
   * Removes the persisted agent ID and fires the switch event with
   * undefined. Note: AdapterRegistry has no clearActiveAdapter method,
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
