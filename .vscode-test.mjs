import { defineConfig } from '@vscode/test-cli';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Integration tests run the real extension inside a headless VS Code via
// @vscode/test-electron. They are compiled to out/test/integration/ by
// src/test/integration/tsconfig.json (see the `pretest:integration` script).
//
// Isolation strategy:
//  - Project-scope tools bind to the launch workspace folder, which providers
//    capture at activation time. We open a stable temp workspace so each test
//    can read it via vscode.workspace.workspaceFolders[0] and clean its tool
//    dirs between tests.
//  - User-scope reads/writes resolve os.homedir()/$HERMES_HOME live (provider
//    path getters), so each test points process.env.HOME at its own temp home.
//    We launch with a throwaway boot HOME so the one-time startup activation
//    never touches the developer's real ~/.claude / ~/.codex / etc.

const workspaceFolder = path.join(os.tmpdir(), 'ack-integration-workspace');
fs.mkdirSync(workspaceFolder, { recursive: true });

const bootHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ack-integration-boot-'));
fs.mkdirSync(path.join(bootHome, '.hermes'), { recursive: true });

export default defineConfig({
  files: 'out/test/integration/**/*.test.js',
  workspaceFolder,
  version: 'stable',
  // --disable-extensions keeps the host hermetic and guarantees GitHub.copilot
  // is absent (Copilot detection is extension-gated -> stays out of the gate).
  // --no-sandbox is required to launch Electron as the current user on Linux CI.
  launchArgs: ['--disable-extensions', '--no-sandbox'],
  env: {
    HOME: bootHome,
    HERMES_HOME: path.join(bootHome, '.hermes'),
    HERMES_MANAGED_DIR: path.join(bootHome, 'managed-hermes'),
  },
  mocha: {
    ui: 'bdd',
    timeout: 60000,
    slow: 15000,
  },
});
