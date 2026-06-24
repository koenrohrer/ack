import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  activateExtension,
  activateAgent,
  run,
  AgentId,
  cfgPath,
  exists,
  skillNode,
  commandNode,
  mcpNode,
  Scope,
  waitFor,
} from './fixtures/harness';
import { makeSandbox, Sandbox } from './fixtures/sandbox';
import { seedClaudeMarker, writeFileEnsured } from './fixtures/seed';
import { withStubbedInput } from './fixtures/input';

/**
 * Inline tool actions: toggle / move / delete / open. Covers TC-42..TC-49
 * (TC-45 MCP toggle lives in the MCP matrix). Toggle/move/delete operate on
 * synthesized tree nodes; assertions are the resulting on-disk renames/removals.
 */
describe('inline tool actions', () => {
  let sb: Sandbox;

  const skillDir = (name: string, root: string) => path.join(root, '.claude', 'skills', name);
  const seedSkill = (name: string, root: string, file = 'SKILL.md') =>
    writeFileEnsured(path.join(skillDir(name, root), file), `---\nname: ${name}\ndescription: d\n---\nbody\n`);

  before(async () => {
    await activateExtension();
  });
  beforeEach(async () => {
    sb = await makeSandbox();
    await seedClaudeMarker(sb.home);
    await activateAgent(AgentId.claudeCode);
  });
  afterEach(async () => {
    await vscode.workspace
      .getConfiguration('ack')
      .update('skipDeleteConfirmation', false, vscode.ConfigurationTarget.Global);
    await sb.dispose();
  });

  it('TC-42: toggle a skill disables via SKILL.md rename (dir keeps its name)', async () => {
    await seedSkill('sample-skill', sb.home);
    const dir = skillDir('sample-skill', sb.home);

    await run('ack.toggleTool', skillNode({ name: 'sample-skill', dir, scope: Scope.user, status: 'enabled' }));
    assert.ok(exists(path.join(dir, 'SKILL.md.disabled')), 'SKILL.md renamed to .disabled');
    assert.ok(!exists(path.join(dir, 'SKILL.md')), 'SKILL.md gone');
    assert.ok(exists(dir), 'directory keeps its original name');

    await run(
      'ack.toggleTool',
      skillNode({ name: 'sample-skill', dir, scope: Scope.user, disabledFile: true }),
    );
    assert.ok(exists(path.join(dir, 'SKILL.md')), 'SKILL.md restored');
    assert.ok(!exists(path.join(dir, 'SKILL.md.disabled')));
  });

  it('TC-43: re-enable a legacy directory-disabled skill', async () => {
    // Old scheme: the whole directory was renamed with a .disabled suffix.
    await seedSkill('sample-skill.disabled', sb.home);
    const disabledDir = skillDir('sample-skill.disabled', sb.home);
    await run(
      'ack.toggleTool',
      skillNode({ name: 'sample-skill', dir: disabledDir, scope: Scope.user, disabledDir: true }),
    );
    const restored = skillDir('sample-skill', sb.home);
    assert.ok(exists(path.join(restored, 'SKILL.md')), 'directory renamed back, SKILL.md intact');
    assert.ok(!exists(disabledDir), '.disabled directory gone');
  });

  it('TC-44: toggle a command (single file) on/off', async () => {
    const file = path.join(cfgPath.claude.userCommandsDir(sb.home), 'mycmd.md');
    await writeFileEnsured(file, 'hello\n');

    await run('ack.toggleTool', commandNode({ name: 'mycmd', filePath: file, scope: Scope.user, status: 'enabled' }));
    assert.ok(exists(`${file}.disabled`) && !exists(file), 'command file gains .disabled');

    await run(
      'ack.toggleTool',
      commandNode({ name: 'mycmd', filePath: `${file}.disabled`, scope: Scope.user, status: 'disabled' }),
    );
    assert.ok(exists(file) && !exists(`${file}.disabled`), 'command file restored');
  });

  it('TC-46: move a tool between scopes, with conflict overwrite + cancel', async () => {
    // No-conflict move user -> project.
    await seedSkill('sample-skill', sb.home);
    const userDir = skillDir('sample-skill', sb.home);
    await run(
      'ack.moveToolToProject',
      skillNode({ name: 'sample-skill', dir: userDir, scope: Scope.user, status: 'enabled' }),
    );
    assert.ok(!exists(userDir), 'removed from user scope');
    assert.ok(exists(path.join(skillDir('sample-skill', sb.workspace), 'SKILL.md')), 'now at project scope');

    // Conflict: same-named skill at both scopes; moving user -> project prompts.
    await seedSkill('conflicting', sb.home);
    await seedSkill('conflicting', sb.workspace);
    const userConflict = skillNode({
      name: 'conflicting',
      dir: skillDir('conflicting', sb.home),
      scope: Scope.user,
      status: 'enabled',
    });

    // Cancel (Esc) -> source remains.
    await withStubbedInput({ warning: [undefined] }, async () => {
      await run('ack.moveToolToProject', userConflict);
    });
    assert.ok(exists(skillDir('conflicting', sb.home)), 'cancel keeps source');

    // Overwrite -> moves.
    const cap = await withStubbedInput({ warning: ['Overwrite'] }, async (c) => {
      await run('ack.moveToolToProject', userConflict);
      return c;
    });
    assert.ok(cap.warning.some((m) => m.includes('already exists at project scope. Overwrite?')), cap.warning.join('|'));
    assert.ok(!exists(skillDir('conflicting', sb.home)), 'overwrite removes source');
  });

  it('TC-47: delete with confirmation, then "Delete & Don\'t Ask Again"', async () => {
    await seedSkill('one', sb.home);
    await seedSkill('two', sb.home);
    await seedSkill('three', sb.home);

    // Plain delete with confirmation.
    const cap = await withStubbedInput({ warning: ['Delete'] }, async (c) => {
      await run('ack.deleteTool', skillNode({ name: 'one', dir: skillDir('one', sb.home), scope: Scope.user }));
      return c;
    });
    assert.ok(cap.warning.length === 1, 'confirmation shown');
    assert.ok(!exists(skillDir('one', sb.home)), 'deleted');

    // Delete & Don't Ask Again -> flips the global setting.
    await withStubbedInput({ warning: ["Delete & Don't Ask Again"] }, async () => {
      await run('ack.deleteTool', skillNode({ name: 'two', dir: skillDir('two', sb.home), scope: Scope.user }));
    });
    assert.strictEqual(
      vscode.workspace.getConfiguration('ack').get<boolean>('skipDeleteConfirmation'),
      true,
      'setting flipped',
    );

    // Third delete proceeds with NO prompt (no warning stub provided -> none shown).
    const cap3 = await withStubbedInput({}, async (c) => {
      await run('ack.deleteTool', skillNode({ name: 'three', dir: skillDir('three', sb.home), scope: Scope.user }));
      return c;
    });
    assert.deepStrictEqual(cap3.warning, [], 'no confirmation second time');
    assert.ok(!exists(skillDir('three', sb.home)), 'deleted without prompt');
  });

  it('TC-48: open tool source opens the backing config file', async () => {
    const file = cfgPath.claude.userMcp(sb.home);
    await writeFileEnsured(file, JSON.stringify({ mcpServers: { demo: { command: 'npx' } } }, null, 2));
    const tool = mcpNode({ name: 'demo', configPath: file, scope: Scope.user }).tool;

    await run('ack.openToolSource', tool);
    const opened = await waitFor(() => vscode.window.activeTextEditor?.document.uri.fsPath === file);
    assert.ok(opened, 'the MCP config file opened in an editor');
  });

  it('TC-49: refresh the tree without error', async () => {
    await run('ack.refreshToolTree');
    assert.ok(true);
  });
});
