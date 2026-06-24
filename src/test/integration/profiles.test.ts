import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import {
  activateExtension,
  activateAgent,
  run,
  AgentId,
  cfgPath,
  exists,
  readJson,
  skillNode,
  uris,
  Scope,
  waitFor,
} from './fixtures/harness';
import { makeSandbox, Sandbox } from './fixtures/sandbox';
import { seedClaudeFull, seedCodexMarker, seedPiFull, writeFileEnsured } from './fixtures/seed';
import { withStubbedInput, pick, InputScript } from './fixtures/input';

/**
 * Profiles: create-by-selection, switch (complete preset), edit tools, rename,
 * delete, export/import round-trip + convert, workspace association +
 * auto-activation, and per-agent scoping. Covers TC-51..TC-60.
 *
 * Profiles persist in globalState across the whole run, so each test uses unique
 * profile names and asserts only on its own.
 */
describe('profiles', () => {
  let sb: Sandbox;

  const skillFile = (name: string, root: string, file = 'SKILL.md') =>
    path.join(root, '.claude', 'skills', name, file);

  before(async () => {
    await activateExtension();
  });
  beforeEach(async () => {
    sb = await makeSandbox();
    await seedClaudeFull(sb.home);
    await activateAgent(AgentId.claudeCode);
  });
  afterEach(async () => {
    const cfg = vscode.workspace.getConfiguration('ack');
    await cfg.update('autoActivateWorkspaceProfiles', true, vscode.ConfigurationTarget.Global);
    await sb.dispose();
  });

  const createProfile = (name: string, picker: any, extra: InputScript = {}) =>
    withStubbedInput({ inputBox: [name], quickPick: [picker], ...extra }, async (cap) => {
      await run('ack.createProfile');
      return cap;
    });

  const switchTo = (name: string, extra: InputScript = {}) =>
    withStubbedInput({ quickPick: [pick.byLabel(name)], ...extra }, async (cap) => {
      await run('ack.switchProfile');
      return cap;
    });

  /** Open the switch picker read-only and return the listed profile labels. */
  async function profileLabels(): Promise<string[]> {
    const cap = await withStubbedInput({ quickPick: [pick.cancel()], info: [undefined] }, async (c) => {
      await run('ack.switchProfile');
      return c;
    });
    return cap.quickPicks[0]?.items.map((i) => i.label) ?? [];
  }

  // ---- Create by selection -------------------------------------------------

  it('TC-53: create a profile by selecting tools (grouped, blank slate)', async () => {
    const cap = await createProfile('p53-setA', pick.manyByLabels(['hello-claude']));
    const picker = cap.quickPicks[0];
    // Grouped by type with separators; Custom Prompts absent for Claude.
    const separators = picker.items.filter((i) => i.kind === vscode.QuickPickItemKind.Separator).map((i) => i.label);
    assert.ok(separators.includes('Skills') && separators.includes('MCP Servers'), separators.join(','));
    assert.ok(!separators.includes('Custom Prompts'), 'Claude has no custom prompts');
    // Blank slate: nothing pre-checked.
    const toolItems = picker.items.filter((i) => (i as any).key);
    assert.ok(toolItems.every((i) => !i.picked), 'nothing pre-checked on create');
    assert.ok(
      cap.info.some((m) => /^Profile "p53-setA" created — 1 of \d+ tools enabled\.$/.test(m)),
      cap.info.join('|'),
    );
  });

  it('TC-53 (saveAs): Save Tools as Profile opens the same tool picker', async () => {
    const cap = await withStubbedInput(
      { inputBox: ['p53-setB'], quickPick: [pick.manyByLabels(['hello-claude'])] },
      async (c) => {
        await run('ack.saveAsProfile');
        return c;
      },
    );
    assert.ok(cap.quickPicks[0]?.options?.title === 'Create Profile: p53-setB', 'same selection picker');
    assert.ok((await profileLabels()).includes('p53-setB'));
  });

  it('TC-53a: complete-preset on switch, blank slate, cancel, empty selection', async () => {
    // Complete preset: enable only the skill; switching disables everything else.
    await createProfile('p53a-C', pick.manyByLabels(['hello-claude']));
    await switchTo('p53a-C');
    assert.ok(exists(skillFile('hello-claude', sb.home)), 'selected skill enabled');
    assert.ok(exists(path.join(cfgPath.claude.userCommandsDir(sb.home), 'greet.md.disabled')), 'command disabled');
    assert.strictEqual(readJson(cfgPath.claude.userMcp(sb.home)).mcpServers.everything.disabled, true, 'mcp disabled');

    // Cancel: Esc at the picker -> no profile created.
    await createProfile('p53a-cancel', pick.cancel());
    assert.ok(!(await profileLabels()).includes('p53a-cancel'), 'cancel creates nothing');

    // Empty: confirm with nothing checked -> valid all-off preset.
    const cap = await createProfile('p53a-empty', pick.manyNone());
    assert.ok(cap.info.some((m) => /^Profile "p53a-empty" created — 0 of \d+ tools enabled\.$/.test(m)), cap.info.join('|'));
    await switchTo('p53a-empty');
    assert.ok(exists(skillFile('hello-claude', sb.home, 'SKILL.md.disabled')), 'all-off disables the skill');
  });

  // ---- Switch applies state -----------------------------------------------

  it('TC-54: switching reapplies the profile preset after manual changes', async () => {
    await createProfile('p54', pick.manyByLabels(['hello-claude']));
    // Manually disable the skill.
    await run('ack.toggleTool', skillNode({
      name: 'hello-claude',
      dir: path.join(sb.home, '.claude', 'skills', 'hello-claude'),
      scope: Scope.user,
      status: 'enabled',
    }));
    assert.ok(exists(skillFile('hello-claude', sb.home, 'SKILL.md.disabled')));
    // Switching back re-enables it (and the toast reports the change).
    const cap = await switchTo('p54');
    assert.ok(cap.info.some((m) => /^Switched to "p54": \d+ tools changed/.test(m)), cap.info.join('|'));
    assert.ok(exists(skillFile('hello-claude', sb.home)), 'skill re-enabled by switch');
  });

  // ---- Edit / rename / delete ---------------------------------------------

  it('TC-55: rename and delete a profile', async () => {
    await createProfile('p55-A', pick.manyByLabels(['hello-claude']));
    await createProfile('p55-B', pick.manyByLabels(['hello-claude']));

    // Rename A -> A2 via Edit Profile.
    const cap = await withStubbedInput(
      { quickPick: [pick.byLabel('p55-A'), pick.byLabel('Rename')], inputBox: ['p55-A2'] },
      async (c) => {
        await run('ack.editProfile');
        return c;
      },
    );
    assert.ok(cap.info.some((m) => m === 'Profile renamed to "p55-A2"'), cap.info.join('|'));

    // Delete B via Delete Profile (modal).
    await withStubbedInput({ quickPick: [pick.byLabel('p55-B')], warning: ['Delete'] }, async () => {
      await run('ack.deleteProfile');
    });

    const labels = await profileLabels();
    assert.ok(labels.includes('p55-A2') && !labels.includes('p55-A'), 'renamed');
    assert.ok(!labels.includes('p55-B'), 'deleted');
  });

  it('TC-55a: Edit Tools pre-checks enabled tools and captures a tool added later', async () => {
    await createProfile('p55a', pick.manyByLabels(['hello-claude']));
    // Add a NEW skill after creation, seeded disabled so we can watch it enable.
    await writeFileEnsured(skillFile('added-skill', sb.home, 'SKILL.md.disabled'), '---\nname: added-skill\n---\nx\n');

    const cap = await withStubbedInput(
      {
        quickPick: [
          pick.byLabel('p55a'),
          pick.byLabel('Edit Tools'),
          pick.manyByLabels(['hello-claude', 'added-skill']),
        ],
      },
      async (c) => {
        await run('ack.editProfile');
        return c;
      },
    );
    const editPicker = cap.quickPicks[2];
    const items = editPicker.items as Array<vscode.QuickPickItem & { key?: string }>;
    const orig = items.find((i) => i.label === 'hello-claude')!;
    const added = items.find((i) => i.label === 'added-skill')!;
    assert.strictEqual(orig.picked, true, 'enabled tool pre-checked');
    assert.strictEqual(added.picked, false, 'tool added after creation appears unchecked');
    assert.ok(cap.info.some((m) => /^Profile "p55a" updated — 2 of \d+ tools enabled\.$/.test(m)), cap.info.join('|'));

    // Switching now enables the newly-added tool.
    await switchTo('p55a');
    assert.ok(exists(skillFile('added-skill', sb.home)), 'added skill enabled after edit+switch');
  });

  it('TC-55a (Custom Prompts): the edit/create picker includes Custom Prompts (Pi)', async () => {
    // Regression: Custom Prompts were once omitted from the picker. They only
    // exist for providers that support them, so assert via Pi.
    await seedPiFull(sb.home);
    await activateAgent(AgentId.pi);
    const cap = await createProfile('p55a-pi', pick.manyNone());
    const separators = cap.quickPicks[0].items
      .filter((i) => i.kind === vscode.QuickPickItemKind.Separator)
      .map((i) => i.label);
    assert.ok(separators.includes('Custom Prompts'), `expected Custom Prompts group, got: ${separators.join(',')}`);
  });

  // ---- Export / import -----------------------------------------------------

  it('TC-56: export a profile writes a bundle with agent metadata', async () => {
    await createProfile('p56', pick.manyByLabels(['hello-claude']));
    const out = path.join(sb.home, 'p56.ackprofile');
    await withStubbedInput(
      { quickPick: [pick.byLabel('p56')], warning: ['Continue'], saveDialog: [vscode.Uri.file(out)] },
      async () => {
        await run('ack.exportProfile');
      },
    );
    const bundle = readJson(out);
    assert.strictEqual(bundle.bundleType, 'ack-profile');
    assert.strictEqual(bundle.agentId, 'claude-code');
    assert.ok(typeof bundle.version === 'number');
    assert.strictEqual(bundle.profile.name, 'p56');
    assert.ok(Array.isArray(bundle.tools));
  });

  it('TC-57: import round-trip (same agent) and convert (different agent)', async () => {
    // Export a profile.
    await createProfile('p57-rt', pick.manyByLabels(['hello-claude']));
    const fileA = path.join(sb.home, 'p57-rt.ackprofile');
    await withStubbedInput(
      { quickPick: [pick.byLabel('p57-rt')], warning: ['Continue'], saveDialog: [vscode.Uri.file(fileA)] },
      async () => {
        await run('ack.exportProfile');
      },
    );
    assert.ok(exists(fileA));

    // Round-trip import -> name conflict -> import as a copy; decline "switch now?".
    await withStubbedInput(
      {
        openDialog: [uris(fileA)],
        quickPick: [pick.byLabelIncludes('imported'), pick.index(0)],
        info: [undefined],
      },
      async () => {
        await run('ack.importProfile');
      },
    );
    assert.ok((await profileLabels()).includes('p57-rt (imported)'), 'round-trip import created a copy');

    // Convert: the same bundle re-tagged as a Codex profile -> convert modal.
    const fileB = path.join(sb.home, 'p57-codex.ackprofile');
    const codexBundle = readJson(fileA);
    codexBundle.agentId = 'codex';
    codexBundle.profile = { ...codexBundle.profile, name: 'p57-cvt' };
    await writeFileEnsured(fileB, JSON.stringify(codexBundle));
    const cap = await withStubbedInput(
      {
        openDialog: [uris(fileB)],
        warning: ['Convert'],
        quickPick: [pick.index(0)], // any per-tool conflict (likely none)
        info: [undefined, undefined], // conversion info + switch prompt
      },
      async (c) => {
        await run('ack.importProfile');
        return c;
      },
    );
    assert.ok(cap.warning.some((m) => m.includes('Convert to Claude Code?')), cap.warning.join('|'));
    assert.ok((await profileLabels()).includes('p57-cvt'), 'converted profile imported');
  });

  // ---- Workspace association + auto-activation -----------------------------

  it('TC-58: associate a profile with the workspace and auto-activate it', async () => {
    await createProfile('p58', pick.manyByLabels(['hello-claude']));
    await withStubbedInput({ quickPick: [pick.byLabel('p58')] }, async () => {
      await run('ack.associateProfile');
    });
    const assocFile = path.join(sb.workspace, '.vscode', 'agent-profile.json');
    assert.ok(exists(assocFile), 'association file written');
    const assoc = readJson(assocFile);
    assert.strictEqual(assoc.profileName, 'p58');
    assert.strictEqual(assoc.agentId, 'claude-code');

    // Disable the skill, then re-trigger agent activation (fires auto-activation).
    await run('ack.toggleTool', skillNode({
      name: 'hello-claude',
      dir: path.join(sb.home, '.claude', 'skills', 'hello-claude'),
      scope: Scope.user,
      status: 'enabled',
    }));
    assert.ok(exists(skillFile('hello-claude', sb.home, 'SKILL.md.disabled')));

    await activateAgent(AgentId.claudeCode);
    const reEnabled = await waitFor(() => exists(skillFile('hello-claude', sb.home)));
    assert.ok(reEnabled, 'associated profile auto-activated and re-enabled the skill');
  });

  it('TC-59: disable workspace auto-activation', async () => {
    await vscode.workspace
      .getConfiguration('ack')
      .update('autoActivateWorkspaceProfiles', false, vscode.ConfigurationTarget.Global);

    await createProfile('p59', pick.manyByLabels(['hello-claude']));
    await withStubbedInput({ quickPick: [pick.byLabel('p59')] }, async () => {
      await run('ack.associateProfile');
    });
    await run('ack.toggleTool', skillNode({
      name: 'hello-claude',
      dir: path.join(sb.home, '.claude', 'skills', 'hello-claude'),
      scope: Scope.user,
      status: 'enabled',
    }));

    await activateAgent(AgentId.claudeCode);
    const reEnabled = await waitFor(() => exists(skillFile('hello-claude', sb.home)), 1500);
    assert.ok(!reEnabled, 'auto-activation disabled -> skill stays disabled');
    assert.ok(exists(skillFile('hello-claude', sb.home, 'SKILL.md.disabled')));
  });

  // ---- Per-agent scoping (TC-52) + migration scoping (TC-51) ---------------

  it('TC-51 / TC-52: profiles are scoped per agent', async () => {
    await createProfile('p52-claude', pick.manyByLabels(['hello-claude']));
    assert.ok((await profileLabels()).includes('p52-claude'), 'visible under Claude');

    // Codex sees no Claude profiles -> switch reports "none", shows no picker.
    await seedCodexMarker(sb.home, 'config');
    await activateAgent(AgentId.codex);
    const cap = await withStubbedInput({ info: [undefined] }, async (c) => {
      await run('ack.switchProfile');
      return c;
    });
    assert.ok(cap.info.some((m) => m.includes('No profiles saved yet')), cap.info.join('|'));
    assert.deepStrictEqual(cap.quickPicks, [], 'no profile picker for Codex');

    // Back to Claude -> the profile reappears (agentId-scoped, TC-51).
    await activateAgent(AgentId.claudeCode);
    assert.ok((await profileLabels()).includes('p52-claude'), 'reappears under Claude');
  });
});
