import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { MCP_CONFIG_SCHEMA_ID, PLUGIN_MANIFEST_SCHEMA_ID } from '../../plugins/plugin.constants.js';
import { ConfigScope } from '../../types/enums.js';
import { ProviderScopeError } from '../../types/provider-errors.js';
import type { AgentProvider } from '../../types/provider.js';
import { runInstallPlugin } from '../../views/tool-tree/tool-tree.plugin-install.js';
import { createMockProvider } from './helpers/mock-provider.js';
import { window as vscodeWindow, workspace as vscodeWorkspace } from './helpers/vscode-stub.js';

/**
 * Scope selection for the `ack.installPlugin` command.
 *
 * `local-install.utils.test.ts` pins what the scope HELPER answers; this file
 * pins that the command asks it the right question. Those are different
 * failures: the helper can be entirely correct while `pickScope` still probes
 * `'skill'` alone, which is precisely the state that makes addendum §A5
 * unreachable for Copilot with no workspace open.
 *
 * `pickScope` is module-private, so everything here drives the exported
 * `runInstallPlugin` and observes only what a user could: which dialogs appear,
 * what the output channel says, and -- the scope itself -- which scope the
 * provider's own `installMcpServer` seam is finally handed. Nothing asserts on
 * a private function's return value, and no production file was changed to make
 * this file importable.
 *
 * The fixture plugin is MCP-only on purpose. It is the smallest package that
 * still reaches a provider write seam carrying the chosen scope, and it is the
 * exact shape §A5 is about: an agent that cannot host skills at all must still
 * receive the plugin's servers.
 */

/** Quoted from `tool-tree.plugin-install.ts` -- the wording is the requirement. */
const NO_LOCATION = 'No install location available. Open a workspace folder and try again.';

const PLUGIN_NAME = 'acme.tools';
const SERVER_NAME = 'notes';

/** `globalStorageUri.fsPath` -- the managed store's two trees live under here. */
let home: string;
/** The folder the open dialog returns, outside the store. */
let source: string;
/** Everything written to the ACK output channel during one run. */
let lines: string[];

beforeEach(async () => {
  // realpath(): on macOS os.tmpdir() is itself a symlink, which would make the
  // store's own containment checks disagree with these paths.
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-cmd-home-')));
  source = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-cmd-src-')));
  lines = [];

  // Fresh spies per test: the stub's properties are module-level, so leaving a
  // previous test's spy in place would make these order-dependent.
  vscodeWorkspace.workspaceFolders = undefined;
  vscodeWindow.showOpenDialog = vi.fn(async () => [{ fsPath: source }]);
  vscodeWindow.showQuickPick = vi.fn(async () => undefined);
  vscodeWindow.showInformationMessage = vi.fn(async () => undefined);
  vscodeWindow.showWarningMessage = vi.fn(async () => undefined);
  vscodeWindow.showErrorMessage = vi.fn(async () => undefined);
});

afterEach(async () => {
  vscodeWorkspace.workspaceFolders = undefined;
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(source, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** An MCP-only package: one manifest, one stdio server, no skills. */
async function writeMcpOnlyPlugin(): Promise<void> {
  await fs.writeFile(
    path.join(source, 'plugin.json'),
    JSON.stringify({
      $schema: PLUGIN_MANIFEST_SCHEMA_ID,
      name: PLUGIN_NAME,
      version: '1.0.0',
    }),
    'utf-8',
  );
  await fs.writeFile(
    path.join(source, 'mcp.json'),
    JSON.stringify({
      $schema: MCP_CONFIG_SCHEMA_ID,
      // `type` is required: §7.2.1 does not let a client infer the transport,
      // and the loader rejects the entry without it.
      mcpServers: { [SERVER_NAME]: { type: 'stdio', command: 'notes-server', args: [] } },
    }),
    'utf-8',
  );
}

type RunArgs = Parameters<typeof runInstallPlugin>;

/** Drive the real command with fakes for its four injected collaborators. */
async function runWith(provider: AgentProvider): Promise<void> {
  await runInstallPlugin(
    { globalStorageUri: { fsPath: home } } as unknown as RunArgs[0],
    { getActiveProvider: () => provider } as unknown as RunArgs[1],
    { refresh: async (): Promise<void> => {} } as unknown as RunArgs[2],
    {
      appendLine: (line: string): void => {
        lines.push(line);
      },
    } as unknown as RunArgs[3],
  );
}

// ---------------------------------------------------------------------------
// Provider shapes -- capability-driven, never identity-driven
// ---------------------------------------------------------------------------

const throwsAnywhere = (label: string, op: string) => (scope: ConfigScope): string => {
  throw new ProviderScopeError(label, scope, op);
};

const userOnly = (label: string, op: string, value: string) => (scope: ConfigScope): string => {
  if (scope !== ConfigScope.User) {
    throw new ProviderScopeError(label, scope, op);
  }
  return value;
};

const anywhere = (value: string) => (): string => value;

interface Harness {
  provider: AgentProvider;
  /** The write seam that finally receives the chosen scope. */
  installMcpServer: ReturnType<typeof spyInstall>;
}

function spyInstall() {
  return vi.fn(
    async (_scope: ConfigScope, _name: string, _config: Record<string, unknown>): Promise<void> => {},
  );
}

function harness(overrides: Partial<AgentProvider>): Harness {
  const installMcpServer = spyInstall();
  return {
    provider: createMockProvider({ installMcpServer, ...overrides }),
    installMcpServer,
  };
}

/** Copilot's shape: no skills directory anywhere, user `mcp.json` only. */
const copilotNoWorkspace = (): Harness =>
  harness({
    displayName: 'GitHub Copilot',
    getSkillsDir: throwsAnywhere('GitHub Copilot', 'getSkillsDir'),
    getCommandsDir: throwsAnywhere('GitHub Copilot', 'getCommandsDir'),
    getMcpFilePath: userOnly('GitHub Copilot', 'getMcpFilePath', '/vscode/User/mcp.json'),
  });

/** Copilot's shape with a folder open: still no skills directory, both MCP scopes real. */
const copilotWithWorkspace = (): Harness =>
  harness({
    displayName: 'GitHub Copilot',
    getSkillsDir: throwsAnywhere('GitHub Copilot', 'getSkillsDir'),
    getCommandsDir: throwsAnywhere('GitHub Copilot', 'getCommandsDir'),
    getMcpFilePath: anywhere('/vscode/mcp.json'),
  });

/** User-scope-only for every component type -- one viable scope even with a folder open. */
const userScopeOnlyAgent = (): Harness =>
  harness({
    displayName: 'Narrow Agent',
    getSkillsDir: userOnly('Narrow Agent', 'getSkillsDir', '/home/user/.narrow/skills'),
    getCommandsDir: userOnly('Narrow Agent', 'getCommandsDir', '/home/user/.narrow/commands'),
    getMcpFilePath: userOnly('Narrow Agent', 'getMcpFilePath', '/home/user/.narrow/mcp.json'),
  });

/** Everything resolves everywhere (the mock-provider defaults). */
const fullyCapableAgent = (): Harness => harness({ displayName: 'Full Agent' });

/** Nothing resolves anywhere -- the only honest "no install location". */
const nowhereAgent = (): Harness =>
  harness({
    displayName: 'Nowhere Agent',
    getSkillsDir: throwsAnywhere('Nowhere Agent', 'getSkillsDir'),
    getCommandsDir: throwsAnywhere('Nowhere Agent', 'getCommandsDir'),
    getMcpFilePath: throwsAnywhere('Nowhere Agent', 'getMcpFilePath'),
  });

/** One folder open. Only the count is read (`workspaceFolders?.length ?? 0`). */
const openWorkspace = [{ name: 'w' }];

/** The quick-pick items `pickScope` builds. */
interface ScopeItem {
  label: string;
  scope: ConfigScope;
}

const quickPickCalls = (): unknown[][] =>
  (vscodeWindow.showQuickPick as unknown as { mock: { calls: unknown[][] } }).mock.calls;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ack.installPlugin -- scope selection', () => {
  it('installs an MCP-only plugin for a Copilot-shaped agent with no workspace open', async () => {
    // The motivating regression. `pickScope` probes 'skill' alone, so Copilot's
    // unwired getSkillsDir empties the candidate list, the Project fallback is
    // unavailable without a workspace, and the user is told there is nowhere to
    // install -- even though this agent's user mcp.json resolves fine and the
    // plugin is servers-only. §A5 is unreachable until the command asks about
    // MCP as well as skills.
    await writeMcpOnlyPlugin();
    const { provider, installMcpServer } = copilotNoWorkspace();
    vscodeWorkspace.workspaceFolders = undefined;

    await runWith(provider);

    expect(installMcpServer).toHaveBeenCalledTimes(1);
    expect(installMcpServer.mock.calls[0][0]).toBe(ConfigScope.User);
    expect(vscodeWindow.showErrorMessage).not.toHaveBeenCalledWith(NO_LOCATION);
  });

  it('auto-selects the only viable scope without showing a quick pick', async () => {
    // Matches LocalInstallService.pickScope, which returns scopes[0] directly
    // rather than prompting with a single option.
    await writeMcpOnlyPlugin();
    const { provider, installMcpServer } = userScopeOnlyAgent();
    vscodeWorkspace.workspaceFolders = openWorkspace;

    await runWith(provider);

    expect(vscodeWindow.showQuickPick).not.toHaveBeenCalled();
    expect(installMcpServer).toHaveBeenCalledTimes(1);
    expect(installMcpServer.mock.calls[0][0]).toBe(ConfigScope.User);
  });

  it('prompts when two scopes are viable and installs into the one chosen', async () => {
    await writeMcpOnlyPlugin();
    const { provider, installMcpServer } = fullyCapableAgent();
    vscodeWorkspace.workspaceFolders = openWorkspace;
    vscodeWindow.showQuickPick = vi.fn(async (items: unknown) =>
      (items as ScopeItem[]).find((item) => item.scope === ConfigScope.Project),
    );

    await runWith(provider);

    expect(vscodeWindow.showQuickPick).toHaveBeenCalledTimes(1);
    const [items, options] = quickPickCalls()[0];
    expect((items as ScopeItem[]).map((item) => item.label)).toEqual([
      'User (Global)',
      'Project (Workspace)',
    ]);
    expect((options as { title: string }).title).toBe('Install Plugin');
    expect(installMcpServer).toHaveBeenCalledTimes(1);
    expect(installMcpServer.mock.calls[0][0]).toBe(ConfigScope.Project);
  });

  it('cancels the install when the scope quick pick is dismissed', async () => {
    // Dismissal must cancel, never silently fall through to a default scope.
    await writeMcpOnlyPlugin();
    const { provider, installMcpServer } = fullyCapableAgent();
    vscodeWorkspace.workspaceFolders = openWorkspace;
    vscodeWindow.showQuickPick = vi.fn(async () => undefined);

    await runWith(provider);

    expect(vscodeWindow.showQuickPick).toHaveBeenCalledTimes(1);
    expect(installMcpServer).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
    expect(vscodeWindow.showInformationMessage).not.toHaveBeenCalled();
    expect(vscodeWindow.showWarningMessage).not.toHaveBeenCalled();
    expect(vscodeWindow.showErrorMessage).not.toHaveBeenCalled();
  });

  it('reports no install location and writes nothing when no scope is viable', async () => {
    await writeMcpOnlyPlugin();
    const { provider, installMcpServer } = nowhereAgent();
    vscodeWorkspace.workspaceFolders = undefined;

    await runWith(provider);

    expect(vscodeWindow.showErrorMessage).toHaveBeenCalledWith(NO_LOCATION);
    expect(installMcpServer).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
    // Nothing reached the managed store -- not even its base directories.
    await expect(fs.access(path.join(home, 'plugins'))).rejects.toThrow();
  });

  it('offers both scopes to a Copilot-shaped agent once a workspace is open', async () => {
    // Derived from the approved union rule rather than stated separately: with a
    // folder open, skills contribute Project (the fallback) and MCP contributes
    // User and Project, so two scopes are offerable and the user must be asked.
    // Today the command auto-selects Project without asking, because the skill
    // probe alone yields exactly one scope.
    await writeMcpOnlyPlugin();
    const { provider } = copilotWithWorkspace();
    vscodeWorkspace.workspaceFolders = openWorkspace;
    vscodeWindow.showQuickPick = vi.fn(async (items: unknown) =>
      (items as ScopeItem[]).find((item) => item.scope === ConfigScope.User),
    );

    await runWith(provider);

    expect(vscodeWindow.showQuickPick).toHaveBeenCalledTimes(1);
    expect((quickPickCalls()[0][0] as ScopeItem[]).map((item) => item.scope)).toEqual([
      ConfigScope.User,
      ConfigScope.Project,
    ]);
  });
});
