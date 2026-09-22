import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileIOService } from '../../services/fileio.service.js';
import { SchemaService } from '../../services/schema.service.js';
import { ClaudeCodeProvider } from '../../providers/claude-code/claude-code.provider.js';
import { CodexProvider } from '../../providers/codex/codex.provider.js';
import { PiProvider } from '../../providers/pi/pi.provider.js';
import { HermesProvider } from '../../providers/hermes/hermes.provider.js';
import { CopilotProvider } from '../../providers/copilot/copilot.provider.js';
import { ConfigScope } from '../../types/enums.js';
import { ProviderScopeError } from '../../types/provider-errors.js';
import { readSkillTree } from '../../plugins/plugin.files.js';
import {
  LATIN1_BYTES,
  PNG_BYTES,
  SVG_TEXT,
  UTF8_TEXT,
  expectSameBytes,
  utf8,
} from './helpers/binary-fixtures.js';

/**
 * `installSkill` must accept a NESTED relative `file.name`.
 *
 * A conformant Agent Plugins skill is a directory tree -- `SKILL.md` plus
 * `scripts/`, `references/` and `assets/` subdirectories (Agent Skills spec,
 * referenced by Agent Plugins §7.1). Today every provider does a single
 * `mkdir(targetDir, {recursive:true})` and then one
 * `writeFile(path.join(targetDir, file.name))` per file, so a nested name such
 * as `references/checklist.md` throws ENOENT. Per DESIGN-phase2-addendum §A4 /
 * §B2, claude-code, codex, pi and hermes must create each file's parent
 * directory before writing. Copilot is exempt (§A5) -- see the last describe.
 *
 * These tests live in one file rather than being split across
 * `provider.test.ts` / `pi-provider.test.ts` / `hermes-provider.test.ts`
 * because the requirement is a single cross-provider contract: the same five
 * cases apply verbatim to four providers, no existing file covers more than one
 * of them, and Copilot has no unit-test file at all. Keeping the matrix in one
 * table means a fifth provider inherits the contract by adding one row.
 */

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

/**
 * Every regular file under `dir`, as slash-separated paths relative to `dir`.
 * Returns [] when `dir` does not exist. Sorted, so it is order-independent.
 */
async function listFilesRecursive(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    const abs = path.join(dir, name);
    if ((await fs.stat(abs)).isDirectory()) {
      for (const nested of await listFilesRecursive(abs)) {
        out.push(`${name}/${nested}`);
      }
    } else {
      out.push(name);
    }
  }
  return out.sort();
}

/** True iff a path exists on disk (file or directory). */
async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Provider matrix
// ---------------------------------------------------------------------------

type SkillFile = { name: string; content: string };

interface SkillInstaller {
  /** Invoke the provider's installSkill in whichever scope it supports. */
  install(skillName: string, files: SkillFile[]): Promise<void>;
  /** The scope's skills directory -- the parent of `<skillName>/`. */
  skillsDir: string;
  /** Root to sweep for files written outside the skill directory. */
  sweepRoot: string;
}

/**
 * Each provider is exercised in a scope that resolves inside the tmp dir, so no
 * test can touch a real `~/.claude`, `~/.codex`, `~/.pi` or `~/.hermes`:
 * claude-code / codex / pi use Project scope rooted at the tmp dir; Hermes has
 * no project scope, so its User scope is redirected via `$HERMES_HOME`
 * (the same mechanism `hermes-provider.test.ts` already uses).
 *
 * The expected skills dir is hardcoded per provider rather than read back from
 * `getSkillsDir()` -- deriving the expectation from the code under test would
 * make these pass against any layout.
 */
const providerCases: Array<{ id: string; make(tmp: string): SkillInstaller }> = [
  {
    id: 'claude-code',
    make(tmp) {
      const provider = new ClaudeCodeProvider(new FileIOService(), new SchemaService(), tmp);
      return {
        install: (name, files) => provider.installSkill(ConfigScope.Project, name, files),
        skillsDir: path.join(tmp, '.claude', 'skills'),
        sweepRoot: tmp,
      };
    },
  },
  {
    id: 'codex',
    make(tmp) {
      const provider = new CodexProvider(new FileIOService(), new SchemaService(), tmp);
      return {
        install: (name, files) => provider.installSkill(ConfigScope.Project, name, files),
        skillsDir: path.join(tmp, '.codex', 'skills'),
        sweepRoot: tmp,
      };
    },
  },
  {
    id: 'pi',
    make(tmp) {
      const provider = new PiProvider(new FileIOService(), new SchemaService(), tmp);
      return {
        install: (name, files) => provider.installSkill(ConfigScope.Project, name, files),
        skillsDir: path.join(tmp, '.pi', 'skills'),
        sweepRoot: tmp,
      };
    },
  },
  {
    id: 'hermes',
    make(tmp) {
      // Hermes skills are user-only; HermesPaths honors $HERMES_HOME.
      process.env.HERMES_HOME = tmp;
      const provider = new HermesProvider(new FileIOService(), new SchemaService());
      return {
        install: (name, files) => provider.installSkill(ConfigScope.User, name, files),
        skillsDir: path.join(tmp, 'skills'),
        sweepRoot: tmp,
      };
    },
  },
];

const SKILL_NAME = 'plugin-demo-skill';

let tmpDir: string;
let savedHermesHome: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'install-skill-nested-'));
  savedHermesHome = process.env.HERMES_HOME;
});

afterEach(async () => {
  if (savedHermesHome === undefined) delete process.env.HERMES_HOME;
  else process.env.HERMES_HOME = savedHermesHome;
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
});

describe.each(providerCases)('$id installSkill — nested skill trees (addendum §A4/§B2)', ({ make }) => {
  it('writes a one-level nested file.name into its parent directory', async () => {
    const target = make(tmpDir);

    await target.install(SKILL_NAME, [
      { name: 'references/checklist.md', content: '# Checklist\n\n- [ ] step one\n' },
    ]);

    const written = await fs.readFile(
      path.join(target.skillsDir, SKILL_NAME, 'references', 'checklist.md'),
      'utf-8',
    );
    expect(written).toBe('# Checklist\n\n- [ ] step one\n');
  });

  it('writes a multi-level nested file.name (mkdir the parent, not just one level)', async () => {
    const target = make(tmpDir);

    await target.install(SKILL_NAME, [
      { name: 'scripts/inner/run.sh', content: '#!/bin/sh\necho hello\n' },
    ]);

    const written = await fs.readFile(
      path.join(target.skillsDir, SKILL_NAME, 'scripts', 'inner', 'run.sh'),
      'utf-8',
    );
    expect(written).toBe('#!/bin/sh\necho hello\n');
  });

  it('installs a mixed flat + nested file list completely', async () => {
    const target = make(tmpDir);

    await target.install(SKILL_NAME, [
      { name: 'SKILL.md', content: '# Demo Skill\n' },
      { name: 'references/x.md', content: 'reference x\n' },
      { name: 'assets/logo.svg', content: '<svg/>\n' },
    ]);

    const skillDir = path.join(target.skillsDir, SKILL_NAME);
    expect(await listFilesRecursive(skillDir)).toEqual([
      'SKILL.md',
      'assets/logo.svg',
      'references/x.md',
    ]);
    expect(await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8')).toBe('# Demo Skill\n');
    expect(await fs.readFile(path.join(skillDir, 'references', 'x.md'), 'utf-8')).toBe('reference x\n');
    expect(await fs.readFile(path.join(skillDir, 'assets', 'logo.svg'), 'utf-8')).toBe('<svg/>\n');
  });

  // REGRESSION GUARD: this one passes before the fix as well as after. It is
  // here to prove the nesting change did not move or re-shape flat installs.
  it('still writes a flat file list exactly where it lands today (backward compatible)', async () => {
    const target = make(tmpDir);

    await target.install(SKILL_NAME, [
      { name: 'SKILL.md', content: '# Demo Skill\n\nDo the thing.' },
      { name: 'helper.md', content: 'Helper content.' },
    ]);

    const skillDir = path.join(target.skillsDir, SKILL_NAME);
    // Exact listing: no extra directories invented, nothing relocated.
    expect(await listFilesRecursive(skillDir)).toEqual(['SKILL.md', 'helper.md']);
    expect(await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8')).toBe('# Demo Skill\n\nDo the thing.');
    expect(await fs.readFile(path.join(skillDir, 'helper.md'), 'utf-8')).toBe('Helper content.');
  });

  // Pinning the FILESYSTEM INVARIANT, not a mechanism: the implementer may
  // reject a traversing name by throwing, by skipping it, or by normalizing it
  // away. What must never happen is a byte landing outside <skillsDir>/<name>/.
  it('does not write outside the skill directory for a traversing file.name', async () => {
    const target = make(tmpDir);
    const skillDir = path.join(target.skillsDir, SKILL_NAME);

    // Throwing is an acceptable mechanism, so a rejection is not a failure here.
    await target
      .install(SKILL_NAME, [{ name: '../escape.md', content: 'ESCAPED' }])
      .catch(() => undefined);

    // Nothing anywhere under the tmp root may sit outside the skill directory.
    // Asserted first because it names the offending path in the failure output.
    const skillPrefix = `${path.relative(target.sweepRoot, skillDir).split(path.sep).join('/')}/`;
    const strays = (await listFilesRecursive(target.sweepRoot)).filter(
      (rel) => !rel.startsWith(skillPrefix),
    );
    expect(strays).toEqual([]);
    expect(await exists(path.join(target.skillsDir, 'escape.md'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Copilot — deliberately exempt
// ---------------------------------------------------------------------------

/**
 * DESIGN-phase2-addendum §A5: Copilot cannot host a directory-shaped skill, so
 * plugin skills are SKIPPED for Copilot with a diagnostic rather than mangled
 * into `.github/agents/`. That makes the flattening below intentional, not a
 * bug waiting to be "fixed" alongside §A4: `installSkill` drops every file into
 * one flat agents directory, discards `skillName` entirely, and rewrites the
 * extension to the compound `.agent.md` Copilot requires.
 *
 * Deliberately absent: any test asking Copilot to honor a nested `file.name`.
 */
describe('copilot installSkill — flattening is deliberate, not an oversight (addendum §A5)', () => {
  /** CopilotProvider only reads `context.globalStorageUri.fsPath` at construction. */
  function makeCopilot(workspaceRoot: string | undefined): CopilotProvider {
    const context = {
      globalStorageUri: { fsPath: path.join(tmpDir, 'globalStorage', 'ack') },
    } as unknown as ConstructorParameters<typeof CopilotProvider>[3];
    return new CopilotProvider(new FileIOService(), new SchemaService(), workspaceRoot, context);
  }

  it('flattens into .github/agents/*.agent.md and ignores the skill name', async () => {
    const provider = makeCopilot(tmpDir);

    await provider.installSkill(ConfigScope.Project, 'plugin-demo-skill', [
      { name: 'SKILL.md', content: '# Demo Agent\n' },
      { name: 'helper.md', content: 'Helper content.' },
    ]);

    const agentsDir = path.join(tmpDir, '.github', 'agents');
    expect(await listFilesRecursive(agentsDir)).toEqual(['SKILL.agent.md', 'helper.agent.md']);
    expect(await fs.readFile(path.join(agentsDir, 'SKILL.agent.md'), 'utf-8')).toBe('# Demo Agent\n');
    // The skill name is not a directory and not a filename component.
    expect(await exists(path.join(agentsDir, 'plugin-demo-skill'))).toBe(false);
  });

  it('throws ProviderScopeError when no workspace is open', async () => {
    const provider = makeCopilot(undefined);

    await expect(
      provider.installSkill(ConfigScope.Project, 'plugin-demo-skill', [
        { name: 'SKILL.md', content: '# Demo Agent\n' },
      ]),
    ).rejects.toThrow(ProviderScopeError);
  });
});

// ---------------------------------------------------------------------------
// Binary skill assets — bytes survive readSkillTree -> installSkill -> disk
// ---------------------------------------------------------------------------

/**
 * A skill may ship binary files under `assets/` (the Agent Skills layout that
 * Agent Plugins §7.1 defers to). The install path reads every file as UTF-8 and
 * writes it back as UTF-8, so a PNG loses every byte that is not valid UTF-8 to
 * U+FFFD. Nothing throws: the user gets a broken asset and no indication.
 *
 * These append to the same four-provider matrix the nesting tests use, because
 * the requirement has the same shape -- one cross-provider contract, inherited
 * through `writeSkillTree`, that a fifth provider picks up by adding a row.
 * Copilot stays exempt (§A5): it does not host directory-shaped skills.
 *
 * Every assertion is `Buffer.equals` against the exact bytes the test wrote to
 * the source tree. A string comparison is not acceptable here -- two equally
 * mangled buffers decode to the same U+FFFD-laden string and would match.
 */

/** The widened file contract: `content` may be raw bytes. */
type WidenedSkillFile = { name: string; content: string | Uint8Array };

/**
 * Invoke a matrix installer with the widened contract.
 *
 * The cast crosses only this file's own harness alias: `SkillInstaller.install`
 * is declared above in terms of the pre-widening `SkillFile`, and that
 * declaration is fixed input. It does not paper over the production signature.
 * `InstallCapability.installSkill` widening in step with `readSkillTree` is
 * enforced by `npm run check-types`, which typechecks
 * `src/plugins/plugin.install.service.ts` -- it hands one straight to the other
 * -- while excluding `src/test/**`.
 */
function installWidened(
  target: SkillInstaller,
  skillName: string,
  files: WidenedSkillFile[],
): Promise<void> {
  const install = target.install as unknown as (
    name: string,
    files: WidenedSkillFile[],
  ) => Promise<void>;
  return install(skillName, files);
}

/** Write raw bytes at a POSIX-relative path beneath `root`, creating parents. */
async function writeBytesAt(root: string, rel: string, bytes: Uint8Array): Promise<void> {
  const full = path.join(root, ...rel.split('/'));
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, bytes);
}

/** Raw bytes of an installed file — never decoded, so nothing can hide. */
async function installedBytes(skillsDir: string, rel: string): Promise<Buffer> {
  return fs.readFile(path.join(skillsDir, SKILL_NAME, ...rel.split('/')));
}

describe.each(providerCases)('$id installSkill — binary skill assets (§7.1)', ({ make }) => {
  it('installs a PNG asset byte-identically through readSkillTree', async () => {
    const target = make(tmpDir);
    const sourceSkill = path.join(tmpDir, '__source__', SKILL_NAME);
    await writeBytesAt(sourceSkill, 'SKILL.md', utf8('# Demo Skill\n'));
    await writeBytesAt(sourceSkill, 'assets/logo.png', PNG_BYTES);

    // The whole chain the user actually exercises: read the package tree, hand
    // it to the provider, look at what landed on disk.
    await installWidened(target, SKILL_NAME, await readSkillTree(sourceSkill));

    expectSameBytes(
      await installedBytes(target.skillsDir, 'assets/logo.png'),
      PNG_BYTES,
      'assets/logo.png',
    );
    // The size check is redundant with the bytes but names the symptom the
    // defect report measured: 33 bytes in, 35 bytes out.
    expect((await installedBytes(target.skillsDir, 'assets/logo.png')).length).toBe(
      PNG_BYTES.length,
    );
    expectSameBytes(
      await installedBytes(target.skillsDir, 'SKILL.md'),
      utf8('# Demo Skill\n'),
      'SKILL.md',
    );
  });

  it('round-trips a mixed tree: Latin-1 .txt, multi-byte UTF-8, .svg and a zero-byte file', async () => {
    const target = make(tmpDir);
    const sourceSkill = path.join(tmpDir, '__source__', SKILL_NAME);
    await writeBytesAt(sourceSkill, 'SKILL.md', utf8(UTF8_TEXT));
    await writeBytesAt(sourceSkill, 'references/notes.txt', LATIN1_BYTES);
    await writeBytesAt(sourceSkill, 'assets/logo.svg', utf8(SVG_TEXT));
    await writeBytesAt(sourceSkill, 'assets/placeholder.bin', new Uint8Array(0));

    await installWidened(target, SKILL_NAME, await readSkillTree(sourceSkill));

    // Latin-1 in a `.txt`: binary by content despite every surface signal, and
    // it must arrive intact rather than as U+FFFD-substituted text.
    expectSameBytes(
      await installedBytes(target.skillsDir, 'references/notes.txt'),
      LATIN1_BYTES,
      'references/notes.txt',
    );
    // Multi-byte UTF-8 stays exactly the bytes it was: the false-positive side.
    expectSameBytes(
      await installedBytes(target.skillsDir, 'SKILL.md'),
      utf8(UTF8_TEXT),
      'SKILL.md',
    );
    expectSameBytes(
      await installedBytes(target.skillsDir, 'assets/logo.svg'),
      utf8(SVG_TEXT),
      'assets/logo.svg',
    );
    expect((await installedBytes(target.skillsDir, 'assets/placeholder.bin')).length).toBe(0);

    // Nothing was dropped or invented while the contract widened.
    expect(await listFilesRecursive(path.join(target.skillsDir, SKILL_NAME))).toEqual([
      'SKILL.md',
      'assets/logo.svg',
      'assets/placeholder.bin',
      'references/notes.txt',
    ]);
  });

  it('writes a Uint8Array content as raw bytes, not as UTF-8 text', async () => {
    // `writeSkillTree` in isolation, bypassing the reader: the writer half of
    // the contract must accept the bytes arm directly, because any future
    // caller that already holds bytes goes straight here.
    const target = make(tmpDir);

    await installWidened(target, SKILL_NAME, [
      { name: 'SKILL.md', content: '# Demo Skill\n' },
      { name: 'assets/logo.png', content: PNG_BYTES },
    ]);

    expectSameBytes(
      await installedBytes(target.skillsDir, 'assets/logo.png'),
      PNG_BYTES,
      'assets/logo.png',
    );
    expectSameBytes(
      await installedBytes(target.skillsDir, 'SKILL.md'),
      utf8('# Demo Skill\n'),
      'SKILL.md',
    );
  });

  // REGRESSION GUARD: green before the widening as well as after. Backward
  // compatibility is the point of the change, so a plain string file list must
  // still land byte-for-byte where and as it always did.
  it('still writes an all-string file list byte-identically (string arm unchanged)', async () => {
    const target = make(tmpDir);

    await installWidened(target, SKILL_NAME, [
      { name: 'SKILL.md', content: UTF8_TEXT },
      { name: 'helper.md', content: 'Helper content.' },
      { name: 'references/x.md', content: 'reference x\n' },
    ]);

    const skillDir = path.join(target.skillsDir, SKILL_NAME);
    expect(await listFilesRecursive(skillDir)).toEqual([
      'SKILL.md',
      'helper.md',
      'references/x.md',
    ]);
    expectSameBytes(await installedBytes(target.skillsDir, 'SKILL.md'), utf8(UTF8_TEXT), 'SKILL.md');
    expectSameBytes(
      await installedBytes(target.skillsDir, 'helper.md'),
      utf8('Helper content.'),
      'helper.md',
    );
    expectSameBytes(
      await installedBytes(target.skillsDir, 'references/x.md'),
      utf8('reference x\n'),
      'references/x.md',
    );
  });
});
