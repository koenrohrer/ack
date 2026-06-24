import * as assert from 'assert';
import * as vscode from 'vscode';
import { activateExtension, activateAgent, run, AgentId, cfgPath, readJson, waitFor } from './fixtures/harness';
import { makeSandbox, Sandbox } from './fixtures/sandbox';
import { seedClaudeFull } from './fixtures/seed';
import { withStubbedInput, pick } from './fixtures/input';

/**
 * Config panel — message PROTOCOL only (no webview DOM, no Playwright).
 * Covers TC-61..TC-63.
 *
 * vscode.window.createWebviewPanel is stubbed to return a fake panel whose
 * webview captures the extension's inbound message handler and records outbound
 * postMessage calls. Tests drive inbound messages and assert outbound messages
 * plus on-disk writes.
 */

interface FakePanelHarness {
  panel: any;
  outbound: any[];
  send(message: any): void;
  dispose(): void;
}

function makeFakePanel(): FakePanelHarness {
  let onMessage: ((m: any) => void) | undefined;
  const disposeHandlers: Array<() => void> = [];
  const outbound: any[] = [];
  let disposed = false;

  const webview: any = {
    html: '',
    cspSource: 'vscode-resource:',
    options: {},
    asWebviewUri: (u: vscode.Uri) => u,
    onDidReceiveMessage: (l: any, _thisArg?: any, ds?: any[]) => {
      onMessage = l;
      const d = { dispose() {} };
      ds?.push(d);
      return d;
    },
    postMessage: async (m: any) => {
      outbound.push(m);
      return true;
    },
  };

  const panel: any = {
    webview,
    title: '',
    visible: true,
    active: true,
    viewColumn: vscode.ViewColumn.One,
    reveal: () => {},
    onDidChangeViewState: (_l: any, _t?: any, ds?: any[]) => {
      const d = { dispose() {} };
      ds?.push(d);
      return d;
    },
    onDidDispose: (l: any, _t?: any, ds?: any[]) => {
      disposeHandlers.push(l);
      const d = { dispose() {} };
      ds?.push(d);
      return d;
    },
    dispose: () => {
      if (disposed) return; // idempotent: ConfigPanel.dispose() re-calls this
      disposed = true;
      for (const h of disposeHandlers) h();
    },
  };

  return { panel, outbound, send: (m) => onMessage?.(m), dispose: () => panel.dispose() };
}

async function withConfigPanel(fn: (h: FakePanelHarness) => Promise<void>): Promise<void> {
  const fake = makeFakePanel();
  const w = vscode.window as any;
  const orig = w.createWebviewPanel;
  w.createWebviewPanel = () => fake.panel;
  try {
    await run('ack.openConfigPanel');
    await fn(fake);
  } finally {
    w.createWebviewPanel = orig;
    fake.dispose(); // resets ConfigPanel.currentPanel for the next test
  }
}

const hasOutbound = (fake: FakePanelHarness, type: string) =>
  waitFor(() => fake.outbound.some((m) => m.type === type));
const lastOutbound = (fake: FakePanelHarness, type: string) =>
  [...fake.outbound].reverse().find((m) => m.type === type);

describe('config panel: message protocol', () => {
  let sb: Sandbox;

  before(async () => {
    await activateExtension();
  });
  beforeEach(async () => {
    sb = await makeSandbox();
    await seedClaudeFull(sb.home);
    await activateAgent(AgentId.claudeCode);
  });
  afterEach(async () => {
    await sb.dispose();
  });

  it('TC-61: panel opens; a "ready" message triggers initial data sends', async () => {
    await withConfigPanel(async (fake) => {
      fake.send({ type: 'ready' });
      assert.ok(await hasOutbound(fake, 'profilesData'), 'profilesData sent');
      assert.ok(await hasOutbound(fake, 'toolsData'), 'toolsData sent');
      assert.ok(await hasOutbound(fake, 'workspaceAssociation'), 'workspaceAssociation sent');
      // toolsData reflects the seeded inventory.
      const tools = lastOutbound(fake, 'toolsData').tools as Array<{ name: string }>;
      assert.ok(tools.some((t) => t.name === 'everything'), 'seeded MCP server present');
    });
  });

  it('TC-62: updateMcpEnv persists to the config file and confirms success', async () => {
    await withConfigPanel(async (fake) => {
      fake.send({
        type: 'updateMcpEnv',
        toolKey: 'mcp_server:everything',
        serverName: 'everything',
        scope: 'user',
        env: { API_KEY: 'secret' },
      });
      assert.ok(
        await waitFor(() => fake.outbound.some((m) => m.type === 'operationSuccess' && m.op === 'updateMcpEnv')),
        'operationSuccess for updateMcpEnv',
      );
      assert.ok(!fake.outbound.some((m) => m.type === 'operationError'), 'no operationError');
      const server = readJson(cfgPath.claude.userMcp(sb.home)).mcpServers.everything;
      assert.strictEqual(server.env.API_KEY, 'secret', 'env persisted to ~/.claude.json');
    });
  });

  it('TC-63: profiles created via commands appear in the panel; panel can create', async () => {
    // Create a profile via the command surface.
    await withStubbedInput(
      { inputBox: ['panel-cmd'], quickPick: [pick.manyNone()] },
      async () => {
        await run('ack.createProfile');
      },
    );

    await withConfigPanel(async (fake) => {
      fake.send({ type: 'requestProfiles' });
      assert.ok(await hasOutbound(fake, 'profilesData'));
      const names = (lastOutbound(fake, 'profilesData').profiles as Array<{ name: string }>).map((p) => p.name);
      assert.ok(names.includes('panel-cmd'), 'command-created profile visible in panel');

      // Panel-driven create -> profilesData updates with the new profile.
      fake.outbound.length = 0;
      fake.send({ type: 'createProfile', name: 'panel-made' });
      const appeared = await waitFor(() =>
        fake.outbound.some(
          (m) => m.type === 'profilesData' && (m.profiles as Array<{ name: string }>).some((p) => p.name === 'panel-made'),
        ),
      );
      assert.ok(appeared, 'panel-created profile reflected in profilesData');
    });
  });
});
