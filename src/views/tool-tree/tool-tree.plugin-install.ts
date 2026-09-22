import * as vscode from 'vscode';
import { mkdir } from 'fs/promises';
import * as path from 'path';
import {
  PluginInstallService,
  type OverwriteConfirmer,
  type PluginFanoutResult,
} from '../../plugins/plugin.install.service.js';
import { PluginStore } from '../../plugins/plugin.store.js';
import type { ProviderRegistry } from '../../providers/provider.registry.js';
import { confirmOverwritePrompt } from '../../services/local-install.service.js';
import { resolvePluginInstallScopes } from '../../services/local-install.utils.js';
import { ConfigScope } from '../../types/enums.js';
import type { AgentProvider } from '../../types/provider.js';
import type { ToolTreeProvider } from './tool-tree.provider.js';

/**
 * The `ack.installPlugin` handler: the `vscode` shell around the Agent Plugins
 * install pipeline.
 *
 * Everything that knows the format lives under `src/plugins` and never imports
 * `vscode`. This file owns only what the extension host can answer -- which
 * folder, which agent, which scope, and how an overwrite question is asked --
 * and then reports what `PluginInstallService` actually did.
 */
export async function runInstallPlugin(
  context: vscode.ExtensionContext,
  registry: ProviderRegistry,
  treeProvider: ToolTreeProvider,
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  try {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: 'Select a plugin folder to install',
      openLabel: 'Install Plugin',
    });
    if (!picked || picked.length === 0) {
      return;
    }
    const sourceDir = picked[0].fsPath;

    const provider = registry.getActiveProvider();
    if (!provider) {
      vscode.window.showErrorMessage('No active agent. Select an agent before installing a plugin.');
      return;
    }

    const scope = await pickScope(provider);
    if (scope === undefined) {
      return;
    }

    const store = await openStore(context);
    const result = await new PluginInstallService(store).install(
      sourceDir,
      provider,
      scope,
      confirmSkillOverwrite,
    );

    reportToOutput(outputChannel, provider.displayName, scope, sourceDir, result);
    await treeProvider.refresh();

    const { message, degraded } = buildSummary(result);
    if (degraded) {
      vscode.window.showWarningMessage(message);
    } else {
      vscode.window.showInformationMessage(message);
    }
  } catch (err: unknown) {
    // Only the store rejects: a fatally invalid package (§11.3.2) or a copy that
    // no longer loads. Its message already names the governing section and the
    // reason, so it is carried through rather than replaced with "failed".
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`Plugin install failed: ${msg}`);
    vscode.window.showErrorMessage(`Install failed: ${msg}`);
  }
}

/**
 * Skills collide by bare name (§D), so the fan-out asks before overwriting one.
 * `kind` is unused today because MCP servers are namespaced per §A3 and can only
 * ever collide with this same plugin's own previous install.
 */
const confirmSkillOverwrite: OverwriteConfirmer = (_kind, name) => confirmOverwritePrompt(name);

/**
 * The managed store, rooted under this extension's global storage (§C):
 * `<globalStorageUri>/plugins/<name>` and `<globalStorageUri>/plugin-data/<name>`.
 *
 * `globalStorageUri` is a location VS Code reserves for us, not one it promises
 * exists -- and nothing in ACK has written there before (Copilot only reads the
 * URI to derive the VS Code user directory). Both trees are created up front so
 * the store never has to reason about a missing base directory.
 */
async function openStore(context: vscode.ExtensionContext): Promise<PluginStore> {
  const pluginsDir = path.join(context.globalStorageUri.fsPath, 'plugins');
  const dataRoot = path.join(context.globalStorageUri.fsPath, 'plugin-data');
  await mkdir(pluginsDir, { recursive: true });
  await mkdir(dataRoot, { recursive: true });
  return new PluginStore(pluginsDir, dataRoot);
}

/**
 * Where to install, using the same scope policy as every other local install.
 *
 * A plugin may ship skills, MCP servers, or both, so the skills probe alone is
 * the wrong question: a Copilot-shaped agent with no workspace open resolves no
 * skills directory and would be told there is nowhere to install, even though
 * its user `mcp.json` resolves and an MCP-only plugin would land there. The
 * union of both probes is what lets §A5 hold -- the skills are skipped by the
 * fan-out (§11.3) and the MCP servers still install.
 */
async function pickScope(provider: AgentProvider): Promise<ConfigScope | undefined> {
  const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
  const scopes = resolvePluginInstallScopes(provider, hasWorkspace);

  if (scopes.length === 0) {
    vscode.window.showErrorMessage(
      'No install location available. Open a workspace folder and try again.',
    );
    return undefined;
  }
  if (scopes.length === 1) {
    return scopes[0];
  }

  interface ScopeItem extends vscode.QuickPickItem {
    scope: ConfigScope;
  }
  const items: ScopeItem[] = scopes.map((scope) => ({
    label: scope === ConfigScope.User ? 'User (Global)' : 'Project (Workspace)',
    scope,
  }));
  const pick = await vscode.window.showQuickPick(items, {
    title: 'Install Plugin',
    placeHolder: 'Select where to install',
  });
  return pick?.scope;
}

/**
 * The full per-component record, including every skip reason and diagnostic.
 *
 * A partial install is the normal case (§11.3): a transport the agent cannot
 * express, or a skill it cannot host, costs that component and nothing else. The
 * notification can only carry counts, so the causes go here.
 */
function reportToOutput(
  channel: vscode.OutputChannel,
  agentName: string,
  scope: ConfigScope,
  sourceDir: string,
  result: PluginFanoutResult,
): void {
  const { record } = result;
  const version = record.version === undefined ? '' : ` ${record.version}`;
  channel.appendLine(`Plugin install: "${record.name}"${version} from ${sourceDir}`);
  channel.appendLine(`  agent: ${agentName} (${scope} scope)`);
  channel.appendLine(`  PLUGIN_ROOT: ${record.root}`);
  channel.appendLine(`  PLUGIN_DATA: ${record.dataDir}`);

  for (const name of result.installedSkills) {
    channel.appendLine(`  skill installed: ${name}`);
  }
  for (const skip of result.skippedSkills) {
    channel.appendLine(`  skill SKIPPED: ${skip.name} -- ${skip.reason}`);
  }
  for (const server of result.installedServers) {
    channel.appendLine(`  server installed: ${server.portable} (as ${server.installed})`);
  }
  for (const skip of result.skippedServers) {
    channel.appendLine(`  server SKIPPED: ${skip.name} -- ${skip.reason}`);
  }
  for (const diagnostic of result.diagnostics) {
    const subject = diagnostic.subject === undefined ? '' : ` [${diagnostic.subject}]`;
    channel.appendLine(
      `  ${diagnostic.severity} §${diagnostic.section}${subject}: ${diagnostic.message}`,
    );
  }
}

/**
 * The one-line outcome, and whether it may be shown as plain success.
 *
 * `degraded` is true whenever anything was skipped or the loader reported an
 * error-severity diagnostic. Those cases go out as a warning: "Installed!" over
 * a plugin whose MCP server silently did not land is the failure mode this
 * whole result type exists to prevent.
 */
function buildSummary(result: PluginFanoutResult): { message: string; degraded: boolean } {
  const installed = countPhrase(result.installedSkills.length, result.installedServers.length);
  const skipped = countPhrase(result.skippedSkills.length, result.skippedServers.length);
  const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
  const degraded = skipped !== undefined || errors > 0;

  let message = `Plugin "${result.record.name}": ${installed === undefined ? 'nothing to install' : `installed ${installed}`}`;
  if (skipped !== undefined) {
    message += ` (${skipped} skipped)`;
  }
  message += '.';
  if (degraded) {
    message += ' See the ACK output channel for details.';
  }
  return { message, degraded };
}

/** e.g. "2 skills, 1 server"; undefined when both counts are zero. */
function countPhrase(skills: number, servers: number): string | undefined {
  const parts: string[] = [];
  if (skills > 0) {
    parts.push(pluralize(skills, 'skill'));
  }
  if (servers > 0) {
    parts.push(pluralize(servers, 'server'));
  }
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
