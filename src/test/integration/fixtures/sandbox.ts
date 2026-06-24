import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Per-test sandbox: an isolated $HOME (and $HERMES_HOME / $HERMES_MANAGED_DIR)
 * plus the shared launch workspace folder.
 *
 * Providers resolve user-scope paths through getHomeDir() -> os.homedir(), which
 * honors $HOME live on POSIX, and Hermes additionally honors $HERMES_HOME. So
 * pointing process.env.HOME at a fresh temp dir redirects every user-scope read
 * and write for the duration of the test -- the real ~/.claude etc. is never
 * touched.
 *
 * Project scope is different: providers capture the workspace root at activation
 * time, so all tests share the single launch workspace folder. We clean its tool
 * dirs between tests instead of swapping it.
 */
export interface Sandbox {
  /** Temp $HOME for this test (user-scope root). */
  readonly home: string;
  /** $HERMES_HOME for this test. */
  readonly hermesHome: string;
  /** The shared launch workspace folder (project-scope root). */
  readonly workspace: string;
  /** Remove the temp home and clean the workspace tool dirs. */
  dispose(): Promise<void>;
}

/** Tool dirs/files a test may create inside the shared workspace. */
const WORKSPACE_TOOL_ENTRIES = [
  '.claude',
  '.codex',
  '.pi',
  '.hermes',
  '.github',
  '.mcp.json',
  path.join('.vscode', 'mcp.json'),
  path.join('.vscode', 'agent-profile.json'),
];

function assertTemp(dir: string): void {
  const tmp = fs.realpathSync(os.tmpdir());
  if (!fs.realpathSync(path.dirname(dir)).startsWith(tmp)) {
    throw new Error(`Refusing to use non-temp sandbox dir: ${dir}`);
  }
}

/** Remove only the known tool artifacts from the shared workspace. */
export async function cleanWorkspace(workspace: string): Promise<void> {
  for (const entry of WORKSPACE_TOOL_ENTRIES) {
    await fs.promises.rm(path.join(workspace, entry), { recursive: true, force: true });
  }
}

/**
 * Create a fresh sandbox and point the process env at it. Call once per test
 * (e.g. in a beforeEach) and dispose in the matching afterEach.
 */
export async function makeSandbox(): Promise<Sandbox> {
  const home = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ack-it-home-'));
  assertTemp(home);

  const hermesHome = path.join(home, '.hermes');
  const hermesManaged = path.join(home, 'managed-hermes-absent');

  process.env.HOME = home;
  process.env.HERMES_HOME = hermesHome;
  // Point the managed dir at a path that never exists so Hermes managed scope
  // (read-only /etc/hermes by default) is fully isolated.
  process.env.HERMES_MANAGED_DIR = hermesManaged;

  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspace) {
    throw new Error('Integration tests require a launch workspace folder (set in .vscode-test.mjs)');
  }
  await cleanWorkspace(workspace);

  return {
    home,
    hermesHome,
    workspace,
    async dispose() {
      await cleanWorkspace(workspace);
      await fs.promises.rm(home, { recursive: true, force: true });
    },
  };
}
