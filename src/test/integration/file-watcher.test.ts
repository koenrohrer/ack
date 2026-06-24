import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { activateExtension, activateAgent, AgentId, settle, waitFor } from './fixtures/harness';
import { makeSandbox, Sandbox } from './fixtures/sandbox';
import { seedClaudeFull, writeJsonEnsured } from './fixtures/seed';
import { withStubbedInput } from './fixtures/input';

/**
 * File watcher / change notifications. Covers TC-64..TC-65.
 *
 * The FileWatcherManager watches the active provider's config dirs, debounces
 * 500ms, then refreshes the tree and (when ack.showChangeNotifications is on)
 * shows the "ACK: Config updated" toast. We modify a PROJECT-scope watched file
 * ({ws}/.mcp.json) inside the launch workspace, which VS Code watches natively.
 *
 * These tests require working OS file watching. A capability self-check probes
 * for it first and skips when unavailable (e.g. a dev box whose inotify instance
 * limit is exhausted by other processes); CI runners exercise them for real.
 */
describe('file watcher / change notifications', () => {
  let sb: Sandbox;
  let watchingWorks = false;

  const touchProjectMcp = (server: string) =>
    writeJsonEnsured(path.join(sb.workspace, '.mcp.json'), {
      mcpServers: { [server]: { command: 'npx' } },
    });

  /** True if a FileSystemWatcher fires for an external write in the workspace. */
  async function probeFileWatching(workspace: string): Promise<boolean> {
    const probeFile = path.join(workspace, '.ack-watch-probe');
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(workspace), '*'),
    );
    let fired = false;
    const subs = [watcher.onDidCreate(() => (fired = true)), watcher.onDidChange(() => (fired = true))];
    try {
      await settle(300);
      await fs.promises.writeFile(probeFile, 'a');
      await settle(150);
      await fs.promises.writeFile(probeFile, 'b');
      await waitFor(() => fired, 3000, 100);
      return fired;
    } finally {
      subs.forEach((s) => s.dispose());
      watcher.dispose();
      await fs.promises.rm(probeFile, { force: true });
    }
  }

  before(async () => {
    await activateExtension();
    const ws = vscode.workspace.workspaceFolders![0].uri.fsPath;
    watchingWorks = await probeFileWatching(ws);
    if (!watchingWorks) {
      console.warn(
        '[file-watcher] OS file watching unavailable (inotify instances exhausted?). ' +
          'Skipping TC-64/65 locally; CI runners exercise them for real.',
      );
    }
  });

  beforeEach(async () => {
    sb = await makeSandbox();
    await seedClaudeFull(sb.home);
    await activateAgent(AgentId.claudeCode); // sets up watchers for this home + workspace
    await settle(300); // let the OS watchers register
  });
  afterEach(async () => {
    await vscode.workspace
      .getConfiguration('ack')
      .update('showChangeNotifications', true, vscode.ConfigurationTarget.Global);
    await sb.dispose();
  });

  it('TC-64: an external edit in a watched dir shows "ACK: Config updated"', async function () {
    if (!watchingWorks) return this.skip();
    await vscode.workspace
      .getConfiguration('ack')
      .update('showChangeNotifications', true, vscode.ConfigurationTarget.Global);

    const cap = await withStubbedInput({}, async (c) => {
      await touchProjectMcp('watched-server');
      await waitFor(() => c.info.includes('ACK: Config updated'), 8000, 150);
      return c;
    });
    assert.ok(cap.info.includes('ACK: Config updated'), `notification not observed: ${cap.info.join('|')}`);
  });

  it('TC-65: notifications can be silenced (tree still refreshes silently)', async function () {
    if (!watchingWorks) return this.skip();
    await vscode.workspace
      .getConfiguration('ack')
      .update('showChangeNotifications', false, vscode.ConfigurationTarget.Global);

    const cap = await withStubbedInput({}, async (c) => {
      await touchProjectMcp('silent-server');
      // Wait well past the 500ms debounce; no notification should appear.
      await settle(2500);
      return c;
    });
    assert.ok(!cap.info.includes('ACK: Config updated'), 'no notification when silenced');
  });
});
