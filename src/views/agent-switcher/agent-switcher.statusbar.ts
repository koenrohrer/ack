import * as vscode from 'vscode';
import type { IPlatformAdapter } from '../../types/adapter.js';

/**
 * Create the agent status bar item.
 *
 * Displays on the left side of the status bar (priority 50) with a
 * default "No Agent" label. Clicking the item runs the provided command.
 */
export function createAgentStatusBar(commandId: string): vscode.StatusBarItem {
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    50,
  );
  statusBar.command = commandId;
  statusBar.text = '$(copilot) No Agent';
  statusBar.tooltip = 'No agent detected\nClick to switch';
  statusBar.show();
  return statusBar;
}

/**
 * Update the agent status bar to reflect the active agent.
 *
 * Shows the agent's display name with a $(copilot) icon when an agent
 * is active, or resets to the default "No Agent" text when undefined.
 */
export function updateAgentStatusBar(
  statusBar: vscode.StatusBarItem,
  agent: IPlatformAdapter | undefined,
): void {
  if (agent) {
    statusBar.text = `$(copilot) ${agent.displayName}`;
    statusBar.tooltip = `Active agent: ${agent.displayName}\nClick to switch`;
  } else {
    statusBar.text = '$(copilot) No Agent';
    statusBar.tooltip = 'No agent detected\nClick to switch';
  }
}
