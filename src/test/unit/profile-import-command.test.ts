import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import type { Profile, SwitchResult } from '../../services/profile.types.js';

/**
 * The `ack.importProfile` command, driven through its registered handler.
 *
 * The shared `vscode` stub has no `commands` namespace, so this file mocks the
 * module with the surface `registerProfileCommands` reaches for. Every dialog
 * is a spy; the profile service is a fake that records what the command asks
 * it to store.
 */
const ui = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  bundlePath: '',
  quickPickLabel: undefined as string | undefined,
  infoAnswer: undefined as string | undefined,
  showOpenDialog: undefined as unknown as ReturnType<typeof vi.fn>,
  showQuickPick: undefined as unknown as ReturnType<typeof vi.fn>,
  showInformationMessage: undefined as unknown as ReturnType<typeof vi.fn>,
  showWarningMessage: undefined as unknown as ReturnType<typeof vi.fn>,
  showErrorMessage: undefined as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock('vscode', () => ({
  commands: {
    registerCommand: (id: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      ui.handlers.set(id, handler);
      return { dispose: () => undefined };
    },
    executeCommand: async () => undefined,
  },
  window: {
    showOpenDialog: (...args: unknown[]) => ui.showOpenDialog(...args),
    showQuickPick: (...args: unknown[]) => ui.showQuickPick(...args),
    showInformationMessage: (...args: unknown[]) => ui.showInformationMessage(...args),
    showWarningMessage: (...args: unknown[]) => ui.showWarningMessage(...args),
    showErrorMessage: (...args: unknown[]) => ui.showErrorMessage(...args),
  },
  workspace: { workspaceFolders: undefined },
  ProgressLocation: { Notification: 15 },
  QuickPickItemKind: { Separator: -1 },
}));

const { registerProfileCommands } = await import('../../views/tool-tree/tool-tree.profile-commands.js');

type RegisterArgs = Parameters<typeof registerProfileCommands>;

const tag = (text: string): string =>
  Array.from(text).map((ch) => String.fromCodePoint(0xe0000 + ch.codePointAt(0)!)).join('');

const NO_FAILURES: SwitchResult = {
  success: true, toggled: 0, skipped: 0, failed: 0, errors: [], incompatibleSkipped: [], nonToggleableSkipped: 0,
};

let dir: string;
let existing: Profile[];
let switchResult: SwitchResult;
let outputLines: string[];
let createProfile: ReturnType<typeof vi.fn>;
let switchProfile: ReturnType<typeof vi.fn>;

function profile(name: string): Profile {
  return { id: `id-${name}`, name, tools: [], createdAt: 'x', updatedAt: 'x' } as unknown as Profile;
}

async function writeBundle(bundle: unknown): Promise<void> {
  ui.bundlePath = path.join(dir, 'shared.ackprofile');
  await fs.writeFile(ui.bundlePath, JSON.stringify(bundle));
}

function bundleNamed(name: string, tools: unknown[] = []): unknown {
  return {
    bundleType: 'ack-profile',
    version: 2,
    agentId: 'claude-code',
    profile: { name, createdAt: 'x', updatedAt: 'x', exportedAt: 'x' },
    tools,
  };
}

async function runImport(): Promise<void> {
  const profileService = {
    getProfiles: () => existing,
    validateImportBundle: () => ({ valid: true }),
    deleteProfile: vi.fn(async () => true),
    analyzeImport: async () => ({ matching: [], conflicts: [], missing: [] }),
    createProfile,
    updateProfile: vi.fn(async () => undefined),
    switchProfile,
  };
  const treeProvider = { setActiveProfile: vi.fn(), refresh: vi.fn() };
  const registry = { getActiveProvider: () => undefined };
  const outputChannel = { appendLine: (line: string) => outputLines.push(line) };
  registerProfileCommands(
    { subscriptions: [] } as unknown as RegisterArgs[0],
    profileService as unknown as RegisterArgs[1],
    {} as unknown as RegisterArgs[2],
    treeProvider as unknown as RegisterArgs[3],
    {} as unknown as RegisterArgs[4],
    registry as unknown as RegisterArgs[5],
    outputChannel as unknown as RegisterArgs[6],
  );
  await ui.handlers.get('ack.importProfile')!();
}

/** Every string argument passed to any dialog or notification. */
function shownText(): string[] {
  const calls = [
    ...ui.showQuickPick.mock.calls,
    ...ui.showInformationMessage.mock.calls,
    ...ui.showWarningMessage.mock.calls,
    ...ui.showErrorMessage.mock.calls,
  ];
  return calls.map((args) => JSON.stringify(args));
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-import-cmd-'));
  existing = [];
  switchResult = NO_FAILURES;
  outputLines = [];
  ui.handlers.clear();
  ui.quickPickLabel = undefined;
  ui.infoAnswer = undefined;
  ui.showOpenDialog = vi.fn(async () => [{ fsPath: ui.bundlePath }]);
  ui.showQuickPick = vi.fn(async (items: Array<{ label: string }>) =>
    items.find((item) => ui.quickPickLabel !== undefined && item.label.startsWith(ui.quickPickLabel)),
  );
  ui.showInformationMessage = vi.fn(async () => ui.infoAnswer);
  ui.showWarningMessage = vi.fn(async () => undefined);
  ui.showErrorMessage = vi.fn(async () => undefined);
  createProfile = vi.fn(async (name: string) => profile(name));
  switchProfile = vi.fn(async () => switchResult);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('ack.importProfile profile name', () => {
  it('stores the bundle name without its hidden, bidi and separator characters', async () => {
    await writeBundle(bundleNamed(`team\u200f\u2028Default\u202eexe.gnp${tag('hidden')}`));

    await runImport();

    expect(createProfile).toHaveBeenCalledWith('teamDefaultexe.gnp');
  });

  it('stores a fixed name when nothing visible is left of the bundle name', async () => {
    await writeBundle(bundleNamed(`\u202e\u200b${tag('x')}`));

    await runImport();

    expect(createProfile).toHaveBeenCalledWith('Imported profile');
  });

  it('finds a name collision by comparing sanitized names', async () => {
    existing = [profile('team')];
    ui.quickPickLabel = 'Import as';
    await writeBundle(bundleNamed('team\u202e'));

    await runImport();

    expect(ui.showQuickPick).toHaveBeenCalledTimes(1);
    expect(createProfile).toHaveBeenCalledWith('team (imported)');
  });

  it('appends the imported suffix after clipping, so the suffix is never cut', async () => {
    const clipped = `${'x'.repeat(79)}…`;
    existing = [profile(clipped)];
    ui.quickPickLabel = 'Import as';
    await writeBundle(bundleNamed('x'.repeat(200)));

    await runImport();

    expect(createProfile).toHaveBeenCalledWith(`${clipped} (imported)`);
    expect(ui.showInformationMessage).toHaveBeenCalledWith(
      `Profile "${clipped} (imported)" imported. Switch to it now?`,
      'Switch',
    );
  });

  it('never shows a hidden character of the bundle name in a dialog or notification', async () => {
    existing = [profile('team')];
    ui.quickPickLabel = 'Import as';
    await writeBundle(bundleNamed(`team\u202e${tag('hidden')}`));

    await runImport();

    const text = shownText().join('\n');
    expect(text).not.toMatch(/\u202e|[\u{e0000}-\u{e007f}]/u);
  });
});
