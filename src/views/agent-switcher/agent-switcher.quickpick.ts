import * as vscode from 'vscode';
import type { ProviderRegistry } from '../../providers/provider.registry.js';

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
  registry: ProviderRegistry,
  activeAgentId: string | undefined,
): Promise<string | undefined> {
  const items: AgentQuickPickItem[] = [];

  for (const provider of registry.getAllProviders()) {
    const detected = await provider.detect();

    // Providers that opt into hideWhenUndetected are omitted entirely while
    // undetected (e.g. Copilot must not appear unless its extension is present).
    if (!detected && provider.hideWhenUndetected) {
      continue;
    }

    const isActive = provider.id === activeAgentId;

    items.push({
      label: provider.displayName,
      description: isActive ? '(active)' : detected ? 'detected' : 'not detected',
      agentId: provider.id,
    });
  }

  const selected = await vscode.window.showQuickPick(items, {
    title: 'Switch Agent',
    placeHolder: 'Select an agent platform',
  });

  return selected?.agentId;
}
