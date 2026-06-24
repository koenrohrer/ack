import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  activateExtension,
  activateAgent,
  redetect,
  probeAgents,
  probeUntil,
  agentDetected,
  agentNotDetected,
  AgentId,
} from './fixtures/harness';
import { makeSandbox, Sandbox } from './fixtures/sandbox';
import { seedClaudeMarker, seedCodexMarker, mkdirEnsured, writeFileEnsured } from './fixtures/seed';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Activation, detection, startup reconcile, and state-aware welcome.
 *
 * Covers TC-1, TC-2, TC-4, TC-6, TC-7..TC-21, TC-50.
 *
 * Reconcile decisions are observed through the Switch Agent quickpick probe:
 *  - `(active)` reflects the persisted agent id (an 'activate' decision persists
 *    the chosen agent), so probe.activeId === the auto-activated agent;
 *  - `detected` / `not detected` reflect a live provider.detect().
 * To keep tests order-independent we persist an UNSEEDED "sentinel" agent before
 * each scenario, so a 'choose'/'none' decision (which never changes persistence)
 * leaves none of the *detected* agents marked active.
 */
describe('activation + detection + reconcile + welcome', () => {
  let sb: Sandbox;
  let ext: vscode.Extension<unknown>;

  before(async () => {
    ext = await activateExtension();
  });

  beforeEach(async () => {
    sb = await makeSandbox();
  });

  afterEach(async () => {
    await sb.dispose();
  });

  // ---- Build & activation -------------------------------------------------

  it('TC-1: extension activates and registers ACK commands', async () => {
    assert.ok(ext.isActive, 'extension is active');
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('ack.redetectAgents'));
    assert.ok(commands.includes('ack.switchAgent'));
    assert.ok(commands.includes('ack.installTool'));
    assert.ok(commands.includes('ack.addMcpServer'));
  });

  // ---- Marketplace removal / settings surface ------------------------------

  it('TC-2: ack.openMarketplace command no longer exists', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(!commands.includes('ack.openMarketplace'), 'marketplace command removed');
  });

  it('TC-4 / TC-6: settings surface is exactly the three ACK settings', () => {
    const props = (ext.packageJSON as any).contributes.configuration.properties as Record<string, unknown>;
    const keys = Object.keys(props).sort();
    assert.deepStrictEqual(keys, [
      'ack.autoActivateWorkspaceProfiles',
      'ack.showChangeNotifications',
      'ack.skipDeleteConfirmation',
    ]);
    assert.ok(!('ack.userRepositories' in props));
    assert.ok(!('ack.registrySources' in props));
  });

  it('TC-50: no user-facing "adapter" terminology in commands', () => {
    const commands = (ext.packageJSON as any).contributes.commands as Array<{ command: string; title: string }>;
    for (const c of commands) {
      assert.ok(!/adapter/i.test(c.title), `title should not mention adapter: ${c.title}`);
      assert.ok(!/adapter/i.test(c.command), `id should not mention adapter: ${c.command}`);
    }
  });

  // ---- Codex detection (scaffolded) ---------------------------------------

  it('TC-7: bare ~/.codex (no markers) is NOT detected', async () => {
    await activateAgent(AgentId.pi); // sentinel (unseeded)
    await mkdirEnsured(path.join(sb.home, '.codex'));
    await writeFileEnsured(path.join(sb.home, '.codex', 'memory.db'), 'junk');
    await redetect();
    const probe = await probeUntil((p) => agentNotDetected(p, AgentId.codex));
    assert.ok(agentNotDetected(probe, AgentId.codex), 'bare .codex is not a marker');
  });

  it('TC-8: config.toml marker -> detected', async () => {
    await seedCodexMarker(sb.home, 'config');
    await redetect();
    const probe = await probeUntil((p) => agentDetected(p, AgentId.codex));
    assert.ok(agentDetected(probe, AgentId.codex));
  });

  it('TC-9: prompts/ marker -> detected AND "create config.toml?" prompt fires', async () => {
    await activateAgent(AgentId.pi); // sentinel so codex is not the active one
    await seedCodexMarker(sb.home, 'prompts');
    const cap = await redetect({ info: ['Dismiss'] });
    assert.ok(
      cap.info.some((m) => m.includes('Codex detected but no config.toml found. Create one?')),
      `expected codex config prompt, got: ${cap.info.join(' | ')}`,
    );
    const probe = await probeUntil((p) => agentDetected(p, AgentId.codex));
    assert.ok(agentDetected(probe, AgentId.codex));
  });

  it('TC-10: skills/ marker -> detected', async () => {
    await seedCodexMarker(sb.home, 'skills');
    await redetect({ info: ['Dismiss'] }); // skills-only also has no config.toml
    const probe = await probeUntil((p) => agentDetected(p, AgentId.codex));
    assert.ok(agentDetected(probe, AgentId.codex));
  });

  it('TC-11: removing all markers -> not detected', async () => {
    await activateAgent(AgentId.pi);
    await seedCodexMarker(sb.home, 'skills');
    await redetect({ info: ['Dismiss'] });
    const probe = await probeUntil((p) => agentDetected(p, AgentId.codex));
    assert.ok(agentDetected(probe, AgentId.codex));

    await fs.promises.rm(path.join(sb.home, '.codex'), { recursive: true, force: true });
    // Re-persist the sentinel: the first redetect auto-activated codex (sole
    // detected), so without this codex would still read as (active)/persisted.
    await activateAgent(AgentId.pi);
    await redetect();
    const probe2 = await probeUntil((p) => agentNotDetected(p, AgentId.codex));
    assert.ok(agentNotDetected(probe2, AgentId.codex));
  });

  // ---- Startup reconcile ---------------------------------------------------

  it('TC-12: single detected agent -> auto-activated', async () => {
    await activateAgent(AgentId.hermes); // sentinel (unseeded)
    await seedClaudeMarker(sb.home);
    await redetect();
    const probe = await probeUntil((p) => p.activeId === AgentId.claudeCode);
    assert.strictEqual(probe.activeId, AgentId.claudeCode);
  });

  it('TC-13: last-used agent wins when multiple are detected', async () => {
    await activateAgent(AgentId.codex); // persisted last-used
    await seedClaudeMarker(sb.home);
    await seedCodexMarker(sb.home, 'config');
    await redetect();
    const probe = await probeUntil((p) => p.activeId === AgentId.codex && agentDetected(p, AgentId.claudeCode));
    assert.strictEqual(probe.activeId, AgentId.codex, 'persisted + still-detected wins');
    assert.ok(agentDetected(probe, AgentId.claudeCode), 'claude also detected but not chosen');
  });

  it('TC-14 / TC-18: two detected + no usable history -> chooser (no auto-pick)', async () => {
    await activateAgent(AgentId.pi); // sentinel: persisted but unseeded
    await seedClaudeMarker(sb.home);
    await seedCodexMarker(sb.home, 'config');
    await redetect();
    const probe = await probeUntil(
      (p) => p.state[AgentId.claudeCode] === 'detected' && p.state[AgentId.codex] === 'detected',
    );
    // Neither detected agent was auto-activated => chooser state.
    assert.strictEqual(probe.state[AgentId.claudeCode], 'detected');
    assert.strictEqual(probe.state[AgentId.codex], 'detected');
    // Copilot is hidden when undetected -> never offered as a chooser button.
    assert.ok(!probe.ids.includes(AgentId.copilot), 'copilot hidden when undetected');
  });

  it('TC-15: persisted agent disappears, one remains -> that one activates', async () => {
    await activateAgent(AgentId.claudeCode); // persisted
    await seedCodexMarker(sb.home, 'config'); // only codex on disk now
    await redetect({ info: ['Dismiss'] });
    const probe = await probeUntil((p) => p.activeId === AgentId.codex);
    assert.strictEqual(probe.activeId, AgentId.codex);
  });

  it('TC-16: re-detect re-runs reconcile as markers change', async () => {
    await activateAgent(AgentId.hermes);
    await seedClaudeMarker(sb.home);
    await redetect();
    const probe = await probeUntil((p) => p.activeId === AgentId.claudeCode && agentNotDetected(p, AgentId.codex));
    assert.strictEqual(probe.activeId, AgentId.claudeCode);
    assert.ok(agentNotDetected(probe, AgentId.codex));

    await seedCodexMarker(sb.home, 'config');
    await redetect();
    const probe2 = await probeUntil((p) => agentDetected(p, AgentId.codex));
    assert.ok(agentDetected(probe2, AgentId.codex), 'codex appears after re-detect');
  });

  // ---- State-aware welcome -------------------------------------------------

  it('TC-17: no-agents state (nothing detected)', async () => {
    await activateAgent(AgentId.pi); // sentinel
    await redetect(); // fresh home: nothing seeded
    const probe = await probeUntil((p) => Object.values(p.state).every((s) => s !== 'detected'));
    const detectedReal = Object.entries(probe.state).filter(([, s]) => s === 'detected');
    assert.deepStrictEqual(detectedReal, [], 'no agent is detected');
  });

  it('TC-19: clicking a chooser button activates that agent', async () => {
    await activateAgent(AgentId.pi); // sentinel -> chooser
    await seedClaudeMarker(sb.home);
    await seedCodexMarker(sb.home, 'config');
    await redetect();
    // Simulate the welcome button: command:ack.activateAgent?["codex"]
    await activateAgent(AgentId.codex);
    const probe = await probeUntil((p) => p.activeId === AgentId.codex);
    assert.strictEqual(probe.activeId, AgentId.codex);
  });

  it('TC-20: single agent with empty tool dirs still auto-activates (no error)', async () => {
    await activateAgent(AgentId.hermes); // sentinel
    await seedClaudeMarker(sb.home); // empty skills/commands, no mcp/hooks
    const cap = await redetect();
    assert.deepStrictEqual(cap.error, []);
    const probe = await probeUntil((p) => p.activeId === AgentId.claudeCode);
    assert.strictEqual(probe.activeId, AgentId.claudeCode);
  });
});
