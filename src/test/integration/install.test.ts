import * as assert from 'assert';
import * as path from 'path';
import {
  activateExtension,
  activateAgent,
  run,
  AgentId,
  cfgPath,
  exists,
  readText,
  groupNode,
  uris,
  ToolType,
} from './fixtures/harness';
import { makeSandbox, Sandbox } from './fixtures/sandbox';
import {
  seedClaudeMarker,
  makeSampleSkillDir,
  makeSampleCommandFile,
  makeSampleCommandFolder,
  makeEmptyDir,
  writeFileEnsured,
} from './fixtures/seed';
import { withStubbedInput, pick } from './fixtures/input';

/**
 * Local install of Skills and Commands (Claude Code). Covers TC-22..TC-32.
 *
 * The install flow is driven entirely through stubbed dialogs:
 *   skill:   showOpenDialog(folder) -> scope pick -> [overwrite] -> success
 *   command: kind pick -> showOpenDialog -> [empty error] -> scope pick -> [overwrite] -> success
 * A workspace is always open in the test host, so the scope picker always shows.
 */
describe('local install: skills + commands', () => {
  let sb: Sandbox;
  let src: string;

  before(async () => {
    await activateExtension();
  });

  beforeEach(async () => {
    sb = await makeSandbox();
    await seedClaudeMarker(sb.home);
    await activateAgent(AgentId.claudeCode);
    src = path.join(sb.home, 'sources');
  });

  afterEach(async () => {
    await sb.dispose();
  });

  const installSkill = (skillDir: string, scopeLabel: string, script: any = {}) =>
    withStubbedInput(
      {
        openDialog: [uris(skillDir)],
        quickPick: [pick.byLabel(scopeLabel)],
        ...script,
      },
      async (cap) => {
        await run('ack.installTool', groupNode(ToolType.skill));
        return cap;
      },
    );

  it('TC-22: install a skill at User scope', async () => {
    const dir = await makeSampleSkillDir(src);
    const cap = await installSkill(dir, 'User (Global)');
    assert.deepStrictEqual(cap.error, []);
    assert.ok(cap.info.some((m) => m === 'Skill "sample-skill" installed (1 file).'), cap.info.join('|'));
    assert.ok(exists(path.join(cfgPath.claude.userSkillsDir(sb.home), 'sample-skill', 'SKILL.md')));
  });

  it('TC-23: install a skill at Project scope', async () => {
    const dir = await makeSampleSkillDir(src);
    const cap = await installSkill(dir, 'Project (Workspace)');
    assert.deepStrictEqual(cap.error, []);
    assert.ok(exists(path.join(cfgPath.claude.projectSkillsDir(sb.workspace), 'sample-skill', 'SKILL.md')));
  });

  it('TC-24: subfolders are reported, not silently dropped', async () => {
    const dir = await makeSampleSkillDir(src);
    await writeFileEnsured(path.join(dir, 'nested', 'extra.md'), 'x\n');
    const cap = await installSkill(dir, 'User (Global)');
    assert.ok(
      cap.info.some((m) => m.includes('Subfolders not copied: nested.')),
      `expected subfolder note, got: ${cap.info.join('|')}`,
    );
    // Only top-level files copied; the nested dir is not.
    const target = path.join(cfgPath.claude.userSkillsDir(sb.home), 'sample-skill');
    assert.ok(exists(path.join(target, 'SKILL.md')));
    assert.ok(!exists(path.join(target, 'nested')));
  });

  it('TC-25: empty folder is rejected', async () => {
    const dir = await makeEmptyDir(src);
    const cap = await withStubbedInput({ openDialog: [uris(dir)] }, async (c) => {
      await run('ack.installTool', groupNode(ToolType.skill));
      return c;
    });
    assert.ok(cap.error.some((m) => m === '"empty-skill" has no files to install.'), cap.error.join('|'));
    assert.ok(!exists(path.join(cfgPath.claude.userSkillsDir(sb.home), 'empty-skill')));
  });

  it('TC-26: overwrite confirmation on name collision', async () => {
    // Seed an existing skill, then install a different-content source over it.
    const existing = path.join(cfgPath.claude.userSkillsDir(sb.home), 'sample-skill', 'SKILL.md');
    await writeFileEnsured(existing, 'OLD\n');
    const dir = await makeSampleSkillDir(src); // content: "body"

    // Cancel (Esc on the overwrite modal) -> nothing changes.
    await installSkill(dir, 'User (Global)', { warning: [undefined] });
    assert.strictEqual(readText(existing), 'OLD\n', 'cancel leaves file untouched');

    // Overwrite -> file replaced.
    const cap = await installSkill(dir, 'User (Global)', { warning: ['Overwrite'] });
    assert.deepStrictEqual(cap.error, []);
    assert.ok(readText(existing).includes('body'), 'overwrite replaces content');
  });

  it('TC-27: cancelling mid-flow is a no-op', async () => {
    const dir = await makeSampleSkillDir(src);
    // (a) Esc at folder picker
    let cap = await withStubbedInput({ openDialog: [undefined] }, async (c) => {
      await run('ack.installTool', groupNode(ToolType.skill));
      return c;
    });
    assert.deepStrictEqual(cap.error, []);
    assert.deepStrictEqual(cap.info, []);
    // (b) Esc at scope picker
    cap = await withStubbedInput({ openDialog: [uris(dir)], quickPick: [pick.cancel()] }, async (c) => {
      await run('ack.installTool', groupNode(ToolType.skill));
      return c;
    });
    assert.deepStrictEqual(cap.info, []);
    assert.ok(!exists(path.join(cfgPath.claude.userSkillsDir(sb.home), 'sample-skill')));
  });

  it('TC-28: scope picker is presented when a workspace is open', async () => {
    const dir = await makeSampleSkillDir(src);
    const cap = await installSkill(dir, 'User (Global)');
    // The scope quickpick offered both User and Project.
    const scopePick = cap.quickPicks.find((q) => q.options?.title === 'Install Location');
    assert.ok(scopePick, 'scope picker shown');
    const labels = scopePick!.items.map((i) => i.label);
    assert.deepStrictEqual(labels, ['User (Global)', 'Project (Workspace)']);
  });

  it('TC-29: install a single-file command', async () => {
    const file = await makeSampleCommandFile(src); // mycmd.md
    const cap = await withStubbedInput(
      {
        quickPick: [pick.byLabel('Single file'), pick.byLabel('User (Global)')],
        openDialog: [uris(file)],
      },
      async (c) => {
        await run('ack.installTool', groupNode(ToolType.command));
        return c;
      },
    );
    assert.deepStrictEqual(cap.error, []);
    assert.ok(cap.info.some((m) => m === 'Command "mycmd" installed (1 file).'), cap.info.join('|'));
    assert.ok(exists(path.join(cfgPath.claude.userCommandsDir(sb.home), 'mycmd.md')));
  });

  it('TC-30: install a multi-file folder command', async () => {
    const folder = await makeSampleCommandFolder(src); // mycmd-folder/{a,b}.md
    const cap = await withStubbedInput(
      {
        quickPick: [pick.byLabel('Folder (multi-file)'), pick.byLabel('User (Global)')],
        openDialog: [uris(folder)],
      },
      async (c) => {
        await run('ack.installTool', groupNode(ToolType.command));
        return c;
      },
    );
    assert.deepStrictEqual(cap.error, []);
    assert.ok(cap.info.some((m) => m === 'Command "mycmd-folder" installed (2 files).'), cap.info.join('|'));
    const base = path.join(cfgPath.claude.userCommandsDir(sb.home), 'mycmd-folder');
    assert.ok(exists(path.join(base, 'a.md')) && exists(path.join(base, 'b.md')));
  });

  it('TC-31: overwrite conflict names the right target (file vs folder)', async () => {
    // Single-file conflict -> on the file name.
    await writeFileEnsured(path.join(cfgPath.claude.userCommandsDir(sb.home), 'mycmd.md'), 'OLD\n');
    const file = await makeSampleCommandFile(src);
    let cap = await withStubbedInput(
      {
        quickPick: [pick.byLabel('Single file'), pick.byLabel('User (Global)')],
        openDialog: [uris(file)],
        warning: [undefined], // cancel the overwrite
      },
      async (c) => {
        await run('ack.installTool', groupNode(ToolType.command));
        return c;
      },
    );
    assert.ok(cap.warning.some((m) => m.includes('"mycmd.md" already exists')), cap.warning.join('|'));

    // Folder conflict -> on the folder/command name.
    await writeFileEnsured(path.join(cfgPath.claude.userCommandsDir(sb.home), 'mycmd-folder', 'a.md'), 'OLD\n');
    const folder = await makeSampleCommandFolder(src);
    cap = await withStubbedInput(
      {
        quickPick: [pick.byLabel('Folder (multi-file)'), pick.byLabel('User (Global)')],
        openDialog: [uris(folder)],
        warning: [undefined],
      },
      async (c) => {
        await run('ack.installTool', groupNode(ToolType.command));
        return c;
      },
    );
    assert.ok(cap.warning.some((m) => m.includes('"mycmd-folder" already exists')), cap.warning.join('|'));
  });

  it('TC-32: cancel the single/folder quick pick is a no-op', async () => {
    const cap = await withStubbedInput({ quickPick: [pick.cancel()] }, async (c) => {
      await run('ack.installTool', groupNode(ToolType.command));
      return c;
    });
    assert.deepStrictEqual(cap.info, []);
    assert.deepStrictEqual(cap.error, []);
  });
});
