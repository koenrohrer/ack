import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

import { readSkillTree } from '../../plugins/plugin.files.js';
import { PluginInstallService } from '../../plugins/plugin.install.service.js';
import type { OverwriteConfirmer, PluginFanoutResult } from '../../plugins/plugin.install.service.js';
import { PluginStore } from '../../plugins/plugin.store.js';
import { installedServerName } from '../../plugins/plugin.translate.js';
import { readDirFiles } from '../../services/local-install.utils.js';
import { ConfigScope } from '../../types/enums.js';
import { ProviderScopeError } from '../../types/provider-errors.js';
import type { AgentProvider } from '../../types/provider.js';
import type { McpTransportSupport } from '../../types/provider-mcp.js';
import type { PluginDiagnostic } from '../../types/plugin.js';
import { createMockProvider, type MockProviderOverrides } from './helpers/mock-provider.js';
import {
  LATIN1_BYTES,
  PNG_BYTES,
  SVG_TEXT,
  UTF8_TEXT,
  contentOf,
  expectSameBytes,
  utf8,
  type WidenedContent,
} from './helpers/binary-fixtures.js';

/**
 * `readSkillTree` + `PluginInstallService` — the fan-out half of Phase 2, under
 * Agent Plugins 1.0.0 §7.1 (skill layout), §7.2.2.3/§7.2.2.4 (per-entry skip),
 * §9.1 (PLUGIN_ROOT / PLUGIN_DATA) and §11.3 (a failure isolated to one
 * component must not stop the others), plus the phase 2 addendum §A3 (server
 * namespacing), §A5 (a provider that cannot host skills still gets its MCP
 * servers) and §E (install loads the plugin twice, and only the second load's
 * store-rooted paths may reach an agent's config).
 *
 * `PluginStore` is used for real rather than mocked: the §E guarantee this file
 * exists to pin is precisely that the values written into the agent config come
 * from the store's own trees, and a stubbed store could not show that.
 *
 * Canonical `$schema` identifiers are quoted verbatim from §5.2 / §7.2.1; they
 * are normative constants of the format, not values observed from a run.
 */

const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';

/** The plugin name every fixture uses unless it says otherwise. */
const PLUGIN = 'acme.tools';

const SCOPE = ConfigScope.User;

/** The codex descriptor, verbatim from addendum §B1: no field, and no `sse`. */
const CODEX_TRANSPORTS: McpTransportSupport = {
  field: undefined,
  native: { stdio: null, 'streamable-http': null },
};

interface SkillFile {
  name: string;
  content: string;
}

/** Everything the store owns; a stray write outside its two trees is visible. */
let home: string;
/** The plugins tree — PLUGIN_ROOT lives at `<pluginsDir>/<name>`. */
let pluginsDir: string;
/**
 * The plugin-data tree — a SIBLING of the plugins tree, never beneath it. §9.1
 * requires PLUGIN_DATA to survive an update, and the root is exactly what an
 * update replaces, so a path derived from the root cannot satisfy it.
 */
let dataRoot: string;
/** The user-chosen source package, outside both owned trees. */
let source: string;
/** Where the mock provider claims its skills live, so collisions are real. */
let agentSkillsDir: string;
let store: PluginStore;
let service: PluginInstallService;

beforeEach(async () => {
  // realpath(): on macOS os.tmpdir() is itself a symlink, which would make
  // every containment answer — and every path comparison here — wrong by
  // accident.
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-install-home-')));
  source = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-install-src-')));
  agentSkillsDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-install-agent-')));
  pluginsDir = path.join(home, 'plugins');
  dataRoot = path.join(home, 'plugin-data');
  store = new PluginStore(pluginsDir, dataRoot);
  service = new PluginInstallService(store);
});

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(source, { recursive: true, force: true });
  await fs.rm(agentSkillsDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function writeFileIn(dir: string, rel: string, content: string): Promise<string> {
  const full = path.join(dir, ...rel.split('/'));
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf-8');
  return full;
}

interface PluginSpec {
  name?: string;
  version?: string;
  /** Merged over the generated manifest; use to inject extra/invalid fields. */
  manifestOverrides?: Record<string, unknown>;
  /** Skill directory name -> files relative to that skill directory. */
  skills?: Record<string, Record<string, string>>;
  /** Omit entirely to write no `mcp.json` at all. */
  mcpServers?: Record<string, unknown>;
}

/** A skill directory holding just the one file §7.1 requires. */
function plainSkill(name: string): Record<string, string> {
  return { 'SKILL.md': `---\nname: ${name}\n---\n\n# ${name}\n` };
}

/** Build a plugin package at `dir`. */
async function buildPlugin(dir: string, spec: PluginSpec = {}): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  await writeFileIn(
    dir,
    'plugin.json',
    JSON.stringify({
      $schema: PLUGIN_SCHEMA,
      name: spec.name ?? PLUGIN,
      version: spec.version ?? '1.0.0',
      ...spec.manifestOverrides,
    }),
  );

  for (const [skill, files] of Object.entries(spec.skills ?? {})) {
    for (const [rel, content] of Object.entries(files)) {
      await writeFileIn(dir, `skills/${skill}/${rel}`, content);
    }
  }

  if (spec.mcpServers !== undefined) {
    await writeFileIn(
      dir,
      'mcp.json',
      JSON.stringify({ $schema: MCP_SCHEMA, mcpServers: spec.mcpServers }),
    );
  }
  return dir;
}

/** Where the store must put this plugin's root and data trees. */
const storeRoot = (name: string = PLUGIN): string => path.join(pluginsDir, name);
const storeData = (name: string = PLUGIN): string => path.join(dataRoot, name);

// ---------------------------------------------------------------------------
// Provider harness
// ---------------------------------------------------------------------------

interface Harness {
  provider: AgentProvider;
  installSkill: ReturnType<typeof spyInstallSkill>;
  installMcpServer: ReturnType<typeof spyInstallMcpServer>;
}

function spyInstallSkill(impl?: (scope: ConfigScope, name: string, files: SkillFile[]) => Promise<void>) {
  return vi.fn(impl ?? (async (_scope: ConfigScope, _name: string, _files: SkillFile[]): Promise<void> => {}));
}

function spyInstallMcpServer(
  impl?: (scope: ConfigScope, name: string, config: Record<string, unknown>) => Promise<void>,
) {
  return vi.fn(
    impl ?? (async (_scope: ConfigScope, _name: string, _config: Record<string, unknown>): Promise<void> => {}),
  );
}

/**
 * A complete provider whose two write seams are spies.
 *
 * `getSkillsDir` points at a real temp directory so an overwrite collision can
 * actually exist on disk. `overrides` is spread on top, per the mock-provider
 * helper's own contract — the helper itself is owned elsewhere and untouched.
 */
function makeHarness(overrides: MockProviderOverrides = {}): Harness {
  const installSkill = spyInstallSkill();
  const installMcpServer = spyInstallMcpServer();
  const provider = createMockProvider({
    installSkill,
    installMcpServer,
    getSkillsDir: () => agentSkillsDir,
    ...overrides,
  });
  return { provider, installSkill, installMcpServer };
}

/** A confirmer that always answers `answer`, recording every question asked. */
function confirmer(answer: boolean) {
  return vi.fn(async (_kind: 'skill', _name: string): Promise<boolean> => answer);
}

const alwaysConfirm: OverwriteConfirmer = async () => true;

/** Server names actually written, in call order. */
function writtenServerNames(spy: Harness['installMcpServer']): string[] {
  return spy.mock.calls.map((call) => call[1]);
}

/** Skill names actually written, in call order. */
function writtenSkillNames(spy: Harness['installSkill']): string[] {
  return spy.mock.calls.map((call) => call[1]);
}

/** The config handed to `installMcpServer` for `installedName`. */
function configWrittenFor(spy: Harness['installMcpServer'], installedName: string): Record<string, unknown> {
  const call = spy.mock.calls.find((entry) => entry[1] === installedName);
  if (call === undefined) {
    throw new Error(
      `installMcpServer was never called for ${JSON.stringify(installedName)}; it was called for ${JSON.stringify(writtenServerNames(spy))}`,
    );
  }
  return call[2];
}

/** The file list handed to `installSkill` for `skillName`. */
function filesWrittenFor(spy: Harness['installSkill'], skillName: string): SkillFile[] {
  const call = spy.mock.calls.find((entry) => entry[1] === skillName);
  if (call === undefined) {
    throw new Error(
      `installSkill was never called for ${JSON.stringify(skillName)}; it was called for ${JSON.stringify(writtenSkillNames(spy))}`,
    );
  }
  return call[2];
}

/**
 * The reason recorded for `name`.
 *
 * The contract does not say whether a skipped SERVER is recorded under its
 * portable name or its namespaced one, so identification is by containment:
 * both forms contain the portable name, and no other server's does.
 */
function reasonFor(skipped: Array<{ name: string; reason: string }>, name: string): string {
  const entry = skipped.find((candidate) => candidate.name === name || candidate.name.includes(name));
  if (entry === undefined) {
    throw new Error(
      `nothing identifying ${JSON.stringify(name)} was skipped; skips were ${JSON.stringify(skipped)}`,
    );
  }
  return entry.reason;
}

/** A diagnostic identifies its component through `subject` or in its message. */
function hasDiagnosticFor(diagnostics: PluginDiagnostic[], subject: string): boolean {
  return diagnostics.some((d) => d.subject === subject || d.message.includes(subject));
}

// ===========================================================================
// readSkillTree — §7.1 skill layout (SKILL.md, scripts/, references/, assets/)
// ===========================================================================

describe('readSkillTree — §7.1 directory layout', () => {
  it('returns nested names POSIX-style and relative to the directory it was given', async () => {
    // These names are joined onto a target directory by `installSkill`, so the
    // separator is part of the contract, not an implementation detail: a
    // backslash from `path.join` on Windows would produce one flat file called
    // "references\checklist.md" instead of a nested one.
    const skill = path.join(source, 'deploy');
    await writeFileIn(skill, 'SKILL.md', '# deploy');
    await writeFileIn(skill, 'references/checklist.md', 'check the thing');
    await writeFileIn(skill, 'scripts/inner/run.sh', '#!/bin/sh\necho hi\n');

    const files = await readSkillTree(skill);

    expect(files.map((file) => file.name)).toEqual([
      'SKILL.md',
      'references/checklist.md',
      'scripts/inner/run.sh',
    ]);
    for (const file of files) {
      expect(file.name).not.toContain('\\');
      expect(path.isAbsolute(file.name)).toBe(false);
    }
    expect(files.map((file) => file.content)).toEqual([
      '# deploy',
      'check the thing',
      '#!/bin/sh\necho hi\n',
    ]);
  });

  it('recurses to arbitrary depth, unlike the deliberately flat readDirFiles', async () => {
    const skill = path.join(source, 'deep');
    await writeFileIn(skill, 'SKILL.md', '# deep');
    await writeFileIn(skill, 'a/b/c/d/e/leaf.txt', 'bottom');

    const files = await readSkillTree(skill);

    expect(files.map((file) => file.name)).toEqual(['SKILL.md', 'a/b/c/d/e/leaf.txt']);
    expect(files.find((file) => file.name === 'a/b/c/d/e/leaf.txt')?.content).toBe('bottom');

    // The contrast that makes this module necessary: `readDirFiles` sees only
    // the top level and reports the subdirectory as skipped.
    const flat = await readDirFiles(skill);
    expect(flat.files.map((file) => file.name)).toEqual(['SKILL.md']);
    expect(flat.skippedDirs).toEqual(['a']);
  });

  it('contributes nothing for an empty subdirectory, at any depth, and does not throw', async () => {
    const skill = path.join(source, 'sparse');
    await writeFileIn(skill, 'SKILL.md', '# sparse');
    await fs.mkdir(path.join(skill, 'assets'), { recursive: true });
    await fs.mkdir(path.join(skill, 'scripts', 'empty'), { recursive: true });

    const files = await readSkillTree(skill);

    expect(files).toEqual([{ name: 'SKILL.md', content: '# sparse' }]);
  });

  it('returns a sorted order that does not depend on readdir order', async () => {
    // Created in reverse of the expected order. On a tmpfs `readdir` reports
    // creation order, and on ext4 a directory hash order; neither is sorted,
    // so an implementation that simply forwards readdir cannot pass.
    const skill = path.join(source, 'ordered');
    for (const rel of [
      'zzz.md',
      'refs/z.md',
      'refs/a.md',
      'mid.md',
      'delta.md',
      'charlie.md',
      'bravo.md',
      'alpha.md',
      'SKILL.md',
    ]) {
      await writeFileIn(skill, rel, rel);
    }

    const files = await readSkillTree(skill);

    expect(files.map((file) => file.name)).toEqual([
      'SKILL.md',
      'alpha.md',
      'bravo.md',
      'charlie.md',
      'delta.md',
      'mid.md',
      'refs/a.md',
      'refs/z.md',
      'zzz.md',
    ]);
  });
});

// ===========================================================================
// install — the store runs first, and a fatal source fans nothing out
// ===========================================================================

describe('PluginInstallService.install — store first (DESIGN-phase2 rule 1, §11.3.2)', () => {
  it('rejects a fatally invalid source and writes nothing through either provider seam', async () => {
    // §5.5: `Not A Name!` is not a valid plugin name, which is fatal to the
    // whole package (§11.3.2) — no component may be discovered or installed.
    // The package is otherwise complete, so anything fanned out here would be
    // fan-out that ran before the store had validated the source.
    await buildPlugin(source, {
      manifestOverrides: { name: 'Not A Name!' },
      skills: { deploy: plainSkill('deploy') },
      mcpServers: { github: { type: 'stdio', command: 'npx' } },
    });
    const { provider, installSkill, installMcpServer } = makeHarness();

    await expect(service.install(source, provider, SCOPE, alwaysConfirm)).rejects.toThrow();

    expect(installSkill).not.toHaveBeenCalled();
    expect(installMcpServer).not.toHaveBeenCalled();
    await expect(fs.readdir(pluginsDir).catch(() => [])).resolves.toEqual([]);
  });
});

// ===========================================================================
// install — MCP servers: §A3 namespacing and the §E two-phase-load guarantee
// ===========================================================================

describe('PluginInstallService.install — MCP servers (§A3, §9.1, §E)', () => {
  it('writes each server under <plugin>__<server> and reports both names', async () => {
    await buildPlugin(source, {
      mcpServers: {
        github: { type: 'stdio', command: 'npx' },
        deploy: { type: 'streamable-http', url: 'https://deploy.example.com/mcp' },
      },
    });
    const { provider, installMcpServer } = makeHarness();

    // Typed explicitly: the declared result shape is part of what this file
    // grades, so a drifting field breaks compilation rather than silently
    // producing `undefined` in an assertion.
    const result: PluginFanoutResult = await service.install(source, provider, SCOPE, alwaysConfirm);

    expect(writtenServerNames(installMcpServer).sort()).toEqual([
      'acme.tools__deploy',
      'acme.tools__github',
    ]);
    expect([...result.installedServers].sort((a, b) => a.portable.localeCompare(b.portable))).toEqual([
      { portable: 'deploy', installed: installedServerName(PLUGIN, 'deploy') },
      { portable: 'github', installed: installedServerName(PLUGIN, 'github') },
    ]);
    expect(result.skippedServers).toEqual([]);
    for (const call of installMcpServer.mock.calls) {
      expect(call[0]).toBe(SCOPE);
    }
  });

  it('injects the STORE root and data dir as PLUGIN_ROOT / PLUGIN_DATA, never the source dir', async () => {
    // The §E guarantee reaching the agent's config. `loadPlugin(sourceDir)` is
    // a validation-only load whose resolved paths point at the user's chosen
    // directory; the config written here must come from the second load, made
    // against the installed copy, or the agent ends up referencing a tree the
    // user may move or delete.
    await buildPlugin(source, {
      mcpServers: {
        github: {
          type: 'stdio',
          command: './bin/validator',
          args: ['--data', '${PLUGIN_DATA}/cache'],
          env: { CONFIG: '${PLUGIN_ROOT}/config.json' },
          cwd: '${PLUGIN_ROOT}',
        },
      },
    });
    await writeFileIn(source, 'bin/validator', '#!/bin/sh\n');
    const { provider, installMcpServer } = makeHarness();

    const result = await service.install(source, provider, SCOPE, alwaysConfirm);
    const config = configWrittenFor(installMcpServer, installedServerName(PLUGIN, 'github'));
    const env = config.env as Record<string, string>;

    // §9.1: the two reserved names, set by the client, pointing at the two
    // trees the store owns.
    expect(env.PLUGIN_ROOT).toBe(storeRoot());
    expect(env.PLUGIN_DATA).toBe(storeData());
    expect(env.PLUGIN_ROOT).toBe(result.record.root);
    expect(env.PLUGIN_DATA).toBe(result.record.dataDir);

    // §9.2 expansion happened against the store too, not the source.
    expect(config.args).toEqual(['--data', path.join(storeData(), 'cache')]);
    expect(env.CONFIG).toBe(path.join(storeRoot(), 'config.json'));
    expect(config.cwd).toBe(storeRoot());
    expect(config.command).toBe(path.join(storeRoot(), 'bin', 'validator'));

    // Nothing anywhere in the written config may reference the source tree.
    expect(result.record.root).not.toBe(source);
    expect(JSON.stringify(config)).not.toContain(source);
  });

  it('returns the installed copy as `plugin`, rooted in the store', async () => {
    await buildPlugin(source, {
      skills: { deploy: plainSkill('deploy') },
      mcpServers: { github: { type: 'stdio', command: 'npx' } },
    });
    const { provider } = makeHarness();

    const result = await service.install(source, provider, SCOPE, alwaysConfirm);

    expect(result.record.name).toBe(PLUGIN);
    expect(result.record.root).toBe(storeRoot());
    expect(result.record.dataDir).toBe(storeData());
    expect(result.plugin.root).toBe(storeRoot());
    expect(result.plugin.manifest.name).toBe(PLUGIN);
    // §9.1: PLUGIN_DATA must exist before a subprocess is launched.
    await expect(fs.stat(storeData())).resolves.toBeTruthy();
  });
});

// ===========================================================================
// install — skills are installed as whole trees (§7.1)
// ===========================================================================

describe('PluginInstallService.install — skill trees (§7.1, §A4)', () => {
  it('hands installSkill the full nested file list for each skill', async () => {
    await buildPlugin(source, {
      skills: {
        deploy: {
          'SKILL.md': '# deploy',
          'references/runbook.md': 'roll it back',
          'scripts/rollback.sh': '#!/bin/sh\nexit 0\n',
        },
        summarize: plainSkill('summarize'),
      },
    });
    const { provider, installSkill } = makeHarness();

    const result = await service.install(source, provider, SCOPE, alwaysConfirm);

    expect(writtenSkillNames(installSkill).sort()).toEqual(['deploy', 'summarize']);
    expect([...result.installedSkills].sort()).toEqual(['deploy', 'summarize']);
    expect(result.skippedSkills).toEqual([]);

    const deploy = filesWrittenFor(installSkill, 'deploy');
    expect(deploy.map((file) => file.name).sort()).toEqual([
      'SKILL.md',
      'references/runbook.md',
      'scripts/rollback.sh',
    ]);
    expect(deploy.find((file) => file.name === 'references/runbook.md')?.content).toBe('roll it back');
    expect(deploy.find((file) => file.name === 'scripts/rollback.sh')?.content).toBe('#!/bin/sh\nexit 0\n');

    // Skills are NOT namespaced (addendum §D): the name is the directory name.
    expect(installSkill.mock.calls.every((call) => call[0] === SCOPE)).toBe(true);
  });
});

// ===========================================================================
// install — §7.2.2.4: an inexpressible transport skips one server only
// ===========================================================================

describe('PluginInstallService.install — inexpressible transport (§7.2.2.4, §11.3.3)', () => {
  it('skips only the sse server for a codex-shaped descriptor and installs everything else', async () => {
    await buildPlugin(source, {
      skills: { deploy: plainSkill('deploy') },
      mcpServers: {
        'legacy-events': { type: 'sse', url: 'https://legacy.example.com/sse' },
        local: { type: 'stdio', command: 'npx' },
        remote: { type: 'streamable-http', url: 'https://deploy.example.com/mcp' },
      },
    });
    const { provider, installSkill, installMcpServer } = makeHarness({
      getMcpTransportSupport: () => CODEX_TRANSPORTS,
    });

    const result = await service.install(source, provider, SCOPE, alwaysConfirm);

    // The skip names the transport, so the user can see WHY (§11.3.4).
    expect(reasonFor(result.skippedServers, 'legacy-events')).toContain('sse');

    // Nothing was written for it, under either name.
    for (const written of writtenServerNames(installMcpServer)) {
      expect(written).not.toContain('legacy-events');
    }

    // Every other server, and the skill, installed anyway (§11.3.3).
    expect(writtenServerNames(installMcpServer).sort()).toEqual([
      'acme.tools__local',
      'acme.tools__remote',
    ]);
    expect(result.installedServers.map((entry) => entry.portable).sort()).toEqual(['local', 'remote']);
    expect(writtenSkillNames(installSkill)).toEqual(['deploy']);
    expect(result.installedSkills).toEqual(['deploy']);
  });
});

// ===========================================================================
// install — §A5: no skills directory skips skills, MCP still installs
// ===========================================================================

describe('PluginInstallService.install — provider that cannot host skills (§A5)', () => {
  /** A provider whose skills directory is unresolvable for this scope. */
  function noSkillsDir(id: string): MockProviderOverrides {
    return {
      id,
      getSkillsDir: (scope: ConfigScope): string => {
        throw new ProviderScopeError(id, scope, 'skills');
      },
    };
  }

  // Two different ids, identical capability. The probe MUST be capability
  // driven: an implementation that special-cases `provider.id === 'copilot'`
  // passes the first row and fails the second.
  it.each([['copilot'], ['acme-agent']])(
    'skips every skill with a reason but still installs MCP servers (provider id %s)',
    async (id) => {
      await buildPlugin(source, {
        skills: { deploy: plainSkill('deploy'), summarize: plainSkill('summarize') },
        mcpServers: {
          github: { type: 'stdio', command: 'npx' },
          remote: { type: 'streamable-http', url: 'https://deploy.example.com/mcp' },
        },
      });
      const { provider, installSkill, installMcpServer } = makeHarness(noSkillsDir(id));

      const result = await service.install(source, provider, SCOPE, alwaysConfirm);

      expect(installSkill).not.toHaveBeenCalled();
      expect(result.installedSkills).toEqual([]);
      expect(result.skippedSkills.map((entry) => entry.name).sort()).toEqual(['deploy', 'summarize']);
      for (const entry of result.skippedSkills) {
        expect(entry.reason.length).toBeGreaterThan(0);
      }

      // §A5 / §11.3.3: the rest of the plugin installs.
      expect(writtenServerNames(installMcpServer).sort()).toEqual([
        'acme.tools__github',
        'acme.tools__remote',
      ]);
      expect(result.installedServers.map((entry) => entry.portable).sort()).toEqual(['github', 'remote']);
      expect(result.skippedServers).toEqual([]);
    },
  );

  it('installs skills for a provider named copilot whose skills directory DOES resolve', async () => {
    // The converse of the rows above, closing the other id-branching escape:
    // capability decides, so the id alone must never suppress skills.
    await buildPlugin(source, { skills: { deploy: plainSkill('deploy') } });
    const { provider, installSkill } = makeHarness({ id: 'copilot' });

    const result = await service.install(source, provider, SCOPE, alwaysConfirm);

    expect(writtenSkillNames(installSkill)).toEqual(['deploy']);
    expect(result.installedSkills).toEqual(['deploy']);
    expect(result.skippedSkills).toEqual([]);
  });
});

// ===========================================================================
// install — skill overwrite confirmation
// ===========================================================================

describe('PluginInstallService.install — skill overwrite confirmation', () => {
  /** Pre-create a colliding skill directory in the provider's skills dir. */
  async function existingSkill(name: string): Promise<void> {
    await writeFileIn(path.join(agentSkillsDir, name), 'SKILL.md', '# the user already had this');
  }

  it('consults the confirmer for a colliding skill and installs it when confirmed', async () => {
    await existingSkill('deploy');
    await buildPlugin(source, {
      skills: { deploy: plainSkill('deploy'), fresh: plainSkill('fresh') },
    });
    const { provider, installSkill } = makeHarness();
    const confirm = confirmer(true);

    const result = await service.install(source, provider, SCOPE, confirm);

    expect(confirm).toHaveBeenCalledWith('skill', 'deploy');
    // Only the collision is a question; a name nothing occupies is not.
    expect(confirm.mock.calls).toEqual([['skill', 'deploy']]);
    expect(writtenSkillNames(installSkill).sort()).toEqual(['deploy', 'fresh']);
    expect([...result.installedSkills].sort()).toEqual(['deploy', 'fresh']);
    expect(result.skippedSkills).toEqual([]);
  });

  it('skips a declined skill, leaving the non-colliding skills of the same plugin installed', async () => {
    await existingSkill('deploy');
    await buildPlugin(source, {
      skills: { deploy: plainSkill('deploy'), fresh: plainSkill('fresh') },
      mcpServers: { github: { type: 'stdio', command: 'npx' } },
    });
    const { provider, installSkill, installMcpServer } = makeHarness();
    const confirm = confirmer(false);

    const result = await service.install(source, provider, SCOPE, confirm);

    expect(confirm).toHaveBeenCalledWith('skill', 'deploy');
    expect(writtenSkillNames(installSkill)).toEqual(['fresh']);
    expect(result.installedSkills).toEqual(['fresh']);
    expect(reasonFor(result.skippedSkills, 'deploy').length).toBeGreaterThan(0);
    expect(writtenServerNames(installMcpServer)).toEqual(['acme.tools__github']);
  });

  it('never asks the confirmer about an MCP server — a namespaced collision is this plugin overwriting itself', async () => {
    // §A3 namespaces servers, so `acme.tools__github` can only collide with a
    // previous install of THIS plugin; re-writing it is the correct outcome and
    // a prompt would be noise. The skill collision here proves the confirmer is
    // genuinely wired, so "never asked about the server" is not vacuous.
    await existingSkill('deploy');
    await buildPlugin(source, {
      skills: { deploy: plainSkill('deploy') },
      mcpServers: { github: { type: 'stdio', command: 'npx' } },
    });
    const { provider, installMcpServer } = makeHarness();
    const confirm = confirmer(true);

    await service.install(source, provider, SCOPE, confirm);

    expect(writtenServerNames(installMcpServer)).toEqual(['acme.tools__github']);
    expect(confirm).toHaveBeenCalledTimes(1);
    for (const [kind, name] of confirm.mock.calls) {
      expect(kind).toBe('skill');
      expect(name).not.toContain('github');
      expect(name).not.toContain('__');
    }
  });
});

// ===========================================================================
// install — §11.3.3 per-entry failure isolation
// ===========================================================================

describe('PluginInstallService.install — per-entry failure isolation (§11.3.3)', () => {
  it('isolates a throwing installSkill to that one skill', async () => {
    await buildPlugin(source, {
      skills: {
        alpha: plainSkill('alpha'),
        beta: plainSkill('beta'),
        gamma: plainSkill('gamma'),
      },
      mcpServers: { github: { type: 'stdio', command: 'npx' } },
    });
    const installSkill = spyInstallSkill(async (_scope, name) => {
      if (name === 'beta') {
        throw new Error('EACCES: permission denied');
      }
    });
    const installMcpServer = spyInstallMcpServer();
    const provider = createMockProvider({
      installSkill,
      installMcpServer,
      getSkillsDir: () => agentSkillsDir,
    });

    const result = await service.install(source, provider, SCOPE, alwaysConfirm);

    expect([...result.installedSkills].sort()).toEqual(['alpha', 'gamma']);
    // §11.3.4: the report has to carry the cause, or the failure is
    // undiagnosable from the result alone.
    expect(reasonFor(result.skippedSkills, 'beta')).toContain('EACCES');
    expect(result.skippedSkills.map((entry) => entry.name)).toEqual(['beta']);
    expect(writtenServerNames(installMcpServer)).toEqual(['acme.tools__github']);
    expect(result.installedServers).toEqual([
      { portable: 'github', installed: 'acme.tools__github' },
    ]);
  });

  it('isolates a throwing installMcpServer to that one server', async () => {
    await buildPlugin(source, {
      skills: { deploy: plainSkill('deploy') },
      mcpServers: {
        good: { type: 'stdio', command: 'npx' },
        bad: { type: 'streamable-http', url: 'https://deploy.example.com/mcp' },
      },
    });
    const installSkill = spyInstallSkill();
    const installMcpServer = spyInstallMcpServer(async (_scope, name) => {
      if (name.includes('bad')) {
        throw new Error('ETIMEDOUT: config file is locked');
      }
    });
    const provider = createMockProvider({
      installSkill,
      installMcpServer,
      getSkillsDir: () => agentSkillsDir,
    });

    const result = await service.install(source, provider, SCOPE, alwaysConfirm);

    expect(result.installedServers).toEqual([{ portable: 'good', installed: 'acme.tools__good' }]);
    expect(reasonFor(result.skippedServers, 'bad')).toContain('ETIMEDOUT');
    expect(result.skippedServers).toHaveLength(1);
    expect(writtenSkillNames(installSkill)).toEqual(['deploy']);
    expect(result.installedSkills).toEqual(['deploy']);
  });
});

// ===========================================================================
// install — loader diagnostics reach the caller (§11.3.4)
// ===========================================================================

describe('PluginInstallService.install — loader diagnostics carried through (§11.3.4)', () => {
  it('surfaces what the package itself got wrong, while installing the rest', async () => {
    // Two loader-level reports the caller must be able to show:
    //  - §5.2  an unknown top-level manifest field, ignored non-fatally;
    //  - §7.2.2.3 an individual mcp.json entry that is invalid and skipped.
    await buildPlugin(source, {
      manifestOverrides: { unknownField: 'ignored per §5.2' },
      skills: { deploy: plainSkill('deploy') },
      mcpServers: {
        broken: { type: 'stdio' },
        github: { type: 'stdio', command: 'npx' },
      },
    });
    const { provider, installSkill, installMcpServer } = makeHarness();

    const result = await service.install(source, provider, SCOPE, alwaysConfirm);

    expect(hasDiagnosticFor(result.diagnostics, 'unknownField')).toBe(true);
    expect(hasDiagnosticFor(result.diagnostics, 'broken')).toBe(true);
    expect(result.diagnostics.some((d) => d.section === '5.2')).toBe(true);
    expect(result.diagnostics.some((d) => d.section === '7.2.2')).toBe(true);

    // The valid components still install (§11.3.3).
    expect(writtenServerNames(installMcpServer)).toEqual(['acme.tools__github']);
    expect(writtenSkillNames(installSkill)).toEqual(['deploy']);
  });
});

// ===========================================================================
// Both modules stay importable outside the extension host
// ===========================================================================

describe('module purity', () => {
  const modules: Array<[string, string]> = [
    ['plugin.files.ts', fileURLToPath(new URL('../../plugins/plugin.files.ts', import.meta.url))],
    [
      'plugin.install.service.ts',
      fileURLToPath(new URL('../../plugins/plugin.install.service.ts', import.meta.url)),
    ],
  ];

  it.each(modules)('%s imports vscode neither statically nor dynamically', async (_label, modulePath) => {
    const src = await fs.readFile(modulePath, 'utf-8');
    expect(src).not.toMatch(/from\s+['"]vscode['"]/);
    expect(src).not.toMatch(/require\(\s*['"]vscode['"]\s*\)/);
    expect(src).not.toMatch(/import\(\s*['"]vscode['"]\s*\)/);
  });
});

// ===========================================================================
// readSkillTree — binary-safe content (§7.1 `assets/`)
// ===========================================================================

/**
 * A skill may ship binary files under `assets/`. Today `readSkillTree` reads
 * every entry with `fs.readFile(full, 'utf-8')`, so a PNG arrives as a string
 * in which every byte that is not valid UTF-8 has become U+FFFD -- and the
 * install path then writes that string back as UTF-8. Nothing throws; the user
 * gets a broken asset and no indication.
 *
 * The contract graded here: `content` is a `string` for a file whose bytes
 * survive a UTF-8 decode/encode round trip unchanged, and a `Uint8Array` for
 * one that does not. That round trip is the whole classifier -- not an
 * extension allowlist -- so a Latin-1 `.txt` is binary and an `.svg` is text.
 *
 * Appended as a new section rather than folded into the §7.1 describe above:
 * that block's four tests are fixed input owned by another author, and a pure
 * append cannot disturb them.
 *
 * The section is deliberately typed against the widened contract via
 * `WidenedContent`. `readSkillTree`'s declared `content: string` is assignable
 * to it, so these tests COMPILE and RUN against the unmodified tree and fail on
 * bytes -- a test that only failed to typecheck would prove nothing here, since
 * `check-types` excludes `src/test/**` and vitest strips types without checking
 * them.
 */

/** Write raw bytes at a POSIX-relative path beneath `dir`, creating parents. */
async function writeBytesIn(dir: string, rel: string, bytes: Uint8Array): Promise<string> {
  const full = path.join(dir, ...rel.split('/'));
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, bytes);
  return full;
}

describe('readSkillTree — binary assets survive as bytes (§7.1)', () => {
  it('returns a Uint8Array for a PNG, byte-identical to the file on disk', async () => {
    const skill = path.join(source, 'binary-asset');
    await writeFileIn(skill, 'SKILL.md', '# binary-asset\n');
    await writeBytesIn(skill, 'assets/logo.png', PNG_BYTES);

    const files = await readSkillTree(skill);
    const logo: WidenedContent = contentOf(files, 'assets/logo.png');

    // Bytes first: the failure output then names the corruption directly --
    // 89504e47... becoming efbfbd504e47... is the defect, in hex.
    expectSameBytes(logo, PNG_BYTES, 'assets/logo.png');
    expect(
      logo instanceof Uint8Array,
      `assets/logo.png must be a Uint8Array, got ${typeof logo}`,
    ).toBe(true);
    expect(typeof logo).not.toBe('string');
  });

  it('discriminates within one tree: string for text, Uint8Array for binary', async () => {
    const skill = path.join(source, 'mixed');
    await writeFileIn(skill, 'SKILL.md', '# mixed\n');
    await writeFileIn(skill, 'references/runbook.md', 'roll it back\n');
    await writeBytesIn(skill, 'assets/logo.png', PNG_BYTES);

    const files = await readSkillTree(skill);

    // Both arms asserted explicitly: an implementation that returned bytes for
    // everything would satisfy the binary half alone.
    const md: WidenedContent = contentOf(files, 'SKILL.md');
    const runbook: WidenedContent = contentOf(files, 'references/runbook.md');
    const logo: WidenedContent = contentOf(files, 'assets/logo.png');

    expect(typeof md).toBe('string');
    expect(md).toBe('# mixed\n');
    expect(typeof runbook).toBe('string');
    expect(runbook).toBe('roll it back\n');
    // Bytes before the type check so a failure prints the corrupted hex rather
    // than only `expected false to be true`.
    expectSameBytes(logo, PNG_BYTES, 'assets/logo.png');
    expect(
      logo instanceof Uint8Array,
      `assets/logo.png must be a Uint8Array, got ${typeof logo}`,
    ).toBe(true);

    // The tree is still the whole tree, in the same sorted order.
    expect(files.map((file) => file.name)).toEqual([
      'SKILL.md',
      'assets/logo.png',
      'references/runbook.md',
    ]);
  });

  it('keeps multi-byte UTF-8 text a string and leaves it uncorrupted', async () => {
    // The false-positive guard. Without it, an implementation that returns a
    // Uint8Array for anything non-ASCII passes every binary test above while
    // changing the type of most real skill documentation.
    const skill = path.join(source, 'utf8');
    await writeFileIn(skill, 'SKILL.md', UTF8_TEXT);
    await writeFileIn(skill, 'references/accents.md', 'naïve résumé — ☕\n');

    const files = await readSkillTree(skill);
    const md: WidenedContent = contentOf(files, 'SKILL.md');
    const accents: WidenedContent = contentOf(files, 'references/accents.md');

    expect(typeof md).toBe('string');
    expect(md).toBe(UTF8_TEXT);
    expect(md instanceof Uint8Array).toBe(false);
    expect(typeof accents).toBe('string');
    expect(accents).toBe('naïve résumé — ☕\n');
    // And the codepoints really did survive, not just the JS type.
    expectSameBytes(md, utf8(UTF8_TEXT), 'SKILL.md');
  });

  it('classifies by UTF-8 round trip, not by extension: a Latin-1 .txt is binary, an .svg is text', async () => {
    const skill = path.join(source, 'by-content');
    await writeFileIn(skill, 'SKILL.md', '# by-content\n');
    // `.txt` and no `assets/` prefix -- every surface signal says "text".
    await writeBytesIn(skill, 'references/notes.txt', LATIN1_BYTES);
    // `.svg` under `assets/` -- every surface signal says "binary".
    await writeFileIn(skill, 'assets/logo.svg', SVG_TEXT);

    const files = await readSkillTree(skill);
    const notes: WidenedContent = contentOf(files, 'references/notes.txt');
    const svg: WidenedContent = contentOf(files, 'assets/logo.svg');

    expectSameBytes(notes, LATIN1_BYTES, 'references/notes.txt');
    expect(
      notes instanceof Uint8Array,
      `references/notes.txt must be a Uint8Array, got ${typeof notes}`,
    ).toBe(true);
    expect(typeof svg, 'assets/logo.svg must stay a string').toBe('string');
    expect(svg).toBe(SVG_TEXT);
  });

  it('returns an empty string for a zero-byte file', async () => {
    // Zero bytes round-trip through UTF-8 trivially, so the round-trip
    // classifier must call this text -- and either way it must not throw and
    // must not gain a byte.
    const skill = path.join(source, 'empty');
    await writeFileIn(skill, 'SKILL.md', '# empty\n');
    await writeBytesIn(skill, 'assets/placeholder.bin', new Uint8Array(0));

    const files = await readSkillTree(skill);
    const blank: WidenedContent = contentOf(files, 'assets/placeholder.bin');

    expect(typeof blank).toBe('string');
    expect(blank).toBe('');
    expectSameBytes(blank, new Uint8Array(0), 'assets/placeholder.bin');
  });

  // REGRESSION GUARD: green before the widening as well as after. Backward
  // compatibility is the point of the change -- every existing string caller
  // must keep working unchanged -- so an all-text tree must still be all
  // strings, with `toEqual` pinning the exact objects.
  it('still returns plain strings for an all-text tree (backward compatible)', async () => {
    const skill = path.join(source, 'all-text');
    await writeFileIn(skill, 'SKILL.md', '# all-text\n');
    await writeFileIn(skill, 'references/checklist.md', '- [ ] step one\n');
    await writeFileIn(skill, 'scripts/run.sh', '#!/bin/sh\nexit 0\n');

    const files = await readSkillTree(skill);

    expect(files).toEqual([
      { name: 'SKILL.md', content: '# all-text\n' },
      { name: 'references/checklist.md', content: '- [ ] step one\n' },
      { name: 'scripts/run.sh', content: '#!/bin/sh\nexit 0\n' },
    ]);
    for (const file of files) {
      expect(typeof file.content, `${file.name} must stay a string`).toBe('string');
    }
  });
});
