import * as vscode from 'vscode';
import type { AdapterRegistry } from '../../adapters/adapter.registry.js';

interface AgentQuickPickItem extends vscode.QuickPickItem {
  agentId: string;
}

/**
 * Show a QuickPick listing all registered agents with detection status.
 *
 * Each item shows the agent's display name, whether it is currently active,
 * and whether the agent platform is detected on the system.
 *
 * @returns The selected agent's ID, or undefined if the user cancelled.
 */
export async function showAgentQuickPick(
  registry: AdapterRegistry,
  activeAgentId: string | undefined,
): Promise<string | undefined> {
  const items: AgentQuickPickItem[] = [];

  for (const adapter of registry.getAllAdapters()) {
    const detected = await adapter.detect();
    const isActive = adapter.id === activeAgentId;

    items.push({
      label: adapter.displayName,
      description: isActive ? '(active)' : detected ? 'detected' : 'not detected',
      agentId: adapter.id,
    });
  }

  const selected = await vscode.window.showQuickPick(items, {
    title: 'Switch Agent',
    placeHolder: 'Select an agent platform',
  });

  return selected?.agentId;
}
