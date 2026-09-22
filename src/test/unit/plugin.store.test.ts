import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import type { Stats } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PluginStore } from '../../plugins/plugin.store.js';
import type { InstalledPluginRecord } from '../../plugins/plugin.store.js';
import type { PluginMcpServer, PluginSkill } from '../../types/plugin.js';

/**
 * `PluginStore` — the managed store described in DESIGN-phase2.md, under Agent
 * Plugins 1.0.0 §4.1 (path containment) and §9.1 (PLUGIN_DATA is
 * client-managed, MUST be created, MUST be writable, MUST persist across
 * plugin updates).
 *
 * ACK owns two sibling trees and nothing else:
 *
 *   <pluginsDir>/<plugin-name>/   -> PLUGIN_ROOT  (replaced on update)
 *   <dataRoot>/<plugin-name>/     -> PLUGIN_DATA  (preserved on update)
 *
 * Both are constructor arguments precisely so these tests can point them at a
 * temp dir; `plugin.store.ts` MUST NOT import `vscode`.
 *
 * Canonical identifiers are quoted verbatim from §5.2 / §7.2.1; they are
 * normative constants of the format, not values observed from a run.
 */

const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';

/** Container for everything the store owns, so a stray write is visible. */
let home: string;
/** The plugins tree. Deliberately NOT pre-created: install must create it. */
let pluginsDir: string;
/**
 * The plugin-data tree. A sibling of the plugins tree, never beneath it: §9.1
 * requires PLUGIN_DATA to survive an update and the root is exactly what an
 * update replaces, so a path derived from the root cannot satisfy it.
 */
let dataRoot: string;
/** A user-chosen source directory, outside both owned trees. */
let source: string;
/** Somewhere neither tree may ever reach. */
let outside: string;
let store: PluginStore;

const itSymlink = process.platform === 'win32' ? it.skip : it;

beforeEach(async () => {
  // realpath(): on macOS os.tmpdir() is itself a symlink, which would make
  // every containment answer wrong by accident.
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-store-home-')));
  source = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-store-src-')));
  outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-store-out-')));
  pluginsDir = path.join(home, 'plugins');
  dataRoot = path.join(home, 'plugin-data');
  store = new PluginStore(pluginsDir, dataRoot);
});

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(source, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

interface SourceSpec {
  name?: string;
  version?: string;
  /** Merged over the generated manifest; use to inject invalid fields. */
  manifestOverrides?: Record<string, unknown>;
  /** Skill directory names; each gets a SKILL.md. Pass [] for none. */
  skills?: string[];
  /** `null` writes no mcp.json at all. */
  mcpServers?: Record<string, unknown> | null;
  /** Extra package files, keyed by path relative to the plugin root. */
  files?: Record<string, string>;
}

async function writeInto(dir: string, rel: string, content: string): Promise<string> {
  const full = path.join(dir, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf-8');
  return full;
}

/** Build a conformant plugin package at `dir`, with `spec` applied. */
async function buildSource(dir: string, spec: SourceSpec = {}): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  await writeInto(
    dir,
    'plugin.json',
    JSON.stringify({
      $schema: PLUGIN_SCHEMA,
      name: spec.name ?? 'test-plugin',
      version: spec.version ?? '1.0.0',
      ...spec.manifestOverrides,
    }),
  );
  for (const skill of spec.skills ?? ['summarize']) {
    await writeInto(dir, path.join('skills', skill, 'SKILL.md'), `# ${skill}`);
  }
  if (spec.mcpServers !== null) {
    await writeInto(
      dir,
      'mcp.json',
      JSON.stringify({
        $schema: MCP_SCHEMA,
        mcpServers: spec.mcpServers ?? { local: { type: 'stdio', command: 'npx' } },
      }),
    );
  }
  for (const [rel, content] of Object.entries(spec.files ?? {})) {
    await writeInto(dir, rel, content);
  }
  return dir;
}

/** Sorted directory listing; `[]` when the directory does not exist. */
async function entries(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).sort();
  } catch {
    return [];
  }
}

/** Whether an entry exists at `target` WITHOUT following a final symlink. */
async function lexists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function statOrNull(target: string): Promise<Stats | null> {
  try {
    return await fs.stat(target);
  } catch {
    return null;
  }
}

async function readOrNull(target: string): Promise<string | null> {
  try {
    return await fs.readFile(target, 'utf-8');
  } catch {
    return null;
  }
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Await a promise without deciding whether rejecting is the correct outcome.
 *
 * Used only where DESIGN-phase2.md leaves the failure boundary to the
 * implementer (§4.1 permits skipping the offending entry or rejecting the
 * whole install); the invariant is then asserted against the filesystem rather
 * than against the shape of the outcome.
 */
async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

/** The two owned trees, listed together, for "nothing else was touched". */
async function ownedTrees(): Promise<{ plugins: string[]; data: string[] }> {
  return { plugins: await entries(pluginsDir), data: await entries(dataRoot) };
}

// ---------------------------------------------------------------------------
// Rule 1 — validate with loadPlugin BEFORE copying anything
// ---------------------------------------------------------------------------

describe('PluginStore.install — validates before copying', () => {
  it('copies nothing when the source manifest declares an unsupported $schema (§5.2)', async () => {
    await buildSource(source, {
      manifestOverrides: { $schema: 'https://agent-plugins.org/schemas/2.0.0/plugin.schema.json' },
    });

    // `install` has no failure channel in its return type, so a fatally
    // invalid source can only surface as a rejection.
    await expect(store.install(source)).rejects.toThrow();

    // The point of rule 1 is not that it rejected — it is that nothing landed.
    expect(await ownedTrees()).toEqual({ plugins: [], data: [] });
  });

  it('copies nothing when the source manifest name violates §5.5', async () => {
    // "../escape" fails §5.5 (character set, start/end alphanumeric). It is
    // also the traversal a name would need to leave the plugins tree, so a
    // store that copied first and validated later would create <home>/escape.
    await buildSource(source, { name: '../escape' });

    await expect(store.install(source)).rejects.toThrow();

    // An empty owned tree is fine; a package copied to <home>/escape is not.
    expect(await ownedTrees()).toEqual({ plugins: [], data: [] });
    expect(await lexists(path.join(home, 'escape'))).toBe(false);
  });

  it('copies nothing when the source directory does not exist', async () => {
    const missing = path.join(source, 'no-such-plugin');

    await expect(store.install(missing)).rejects.toThrow();

    expect(await ownedTrees()).toEqual({ plugins: [], data: [] });
  });

  it('installs a source that loads with non-fatal diagnostics (§11.3)', async () => {
    // Only a fatal plugin.json problem blocks the copy. A skill directory with
    // no SKILL.md (§7.1) and an unknown top-level manifest field (§5.2) are
    // both reported-and-skipped, so the package still installs.
    await buildSource(source, {
      skills: ['good'],
      manifestOverrides: { experimentalThing: true },
      files: { 'skills/incomplete/notes.md': 'no SKILL.md here' },
    });

    const { record, plugin } = await store.install(source);

    expect(plugin.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(await lexists(path.join(record.root, 'plugin.json'))).toBe(true);
    expect(await lexists(path.join(record.root, 'skills', 'good', 'SKILL.md'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A source that overlaps the root it would replace
// ---------------------------------------------------------------------------

describe('PluginStore.install — rejects a source that overlaps the installed root', () => {
  it('rejects the installed root itself as the source and leaves it intact', async () => {
    await buildSource(source, { skills: ['alpha'] });
    const { record } = await store.install(source);

    await expect(store.install(record.root)).rejects.toThrow(/overlaps/);

    expect(await readOrNull(path.join(record.root, 'skills', 'alpha', 'SKILL.md'))).toBe('# alpha');
    expect((await store.get('test-plugin'))?.name).toBe('test-plugin');
  });

  it('rejects a source nested inside the installed root and leaves both intact', async () => {
    await buildSource(source);
    const { record } = await store.install(source);
    const nested = await buildSource(path.join(record.root, 'vendored'), { skills: ['inner'] });

    await expect(store.install(nested)).rejects.toThrow(/overlaps/);

    expect(await lexists(path.join(nested, 'skills', 'inner', 'SKILL.md'))).toBe(true);
    expect(await lexists(path.join(record.root, 'plugin.json'))).toBe(true);
  });

  it('rejects a source that contains the managed store and writes nothing into it', async () => {
    // The store lives INSIDE the package the user picked.
    await buildSource(source);
    const nestedStore = new PluginStore(
      path.join(source, 'state', 'plugins'),
      path.join(source, 'state', 'plugin-data'),
    );

    await expect(nestedStore.install(source)).rejects.toThrow(/overlaps/);

    expect(await lexists(path.join(source, 'state'))).toBe(false);
    expect(await lexists(path.join(source, 'plugin.json'))).toBe(true);
  });

  itSymlink('rejects the installed root when it is reached through a symlink', async () => {
    await buildSource(source);
    const { record } = await store.install(source);
    const link = path.join(outside, 'root-link');
    await fs.symlink(record.root, link, 'dir');

    await expect(store.install(link)).rejects.toThrow(/overlaps/);

    expect(await lexists(path.join(record.root, 'plugin.json'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Happy path — the copy and the record
// ---------------------------------------------------------------------------

describe('PluginStore.install — happy path', () => {
  it('copies the package into <pluginsDir>/<name>/ and records the manifest metadata', async () => {
    await buildSource(source, {
      version: '1.2.0',
      skills: ['summarize'],
      mcpServers: { local: { type: 'stdio', command: 'npx' } },
      files: { 'LICENSE': 'MIT' },
    });

    const before = Date.now();
    const { record } = await store.install(source);
    const after = Date.now();

    // The layout is fixed by DESIGN-phase2.md, not merely "somewhere under".
    expect(record.name).toBe('test-plugin');
    expect(record.version).toBe('1.2.0');
    expect(path.isAbsolute(record.root)).toBe(true);
    expect(path.isAbsolute(record.dataDir)).toBe(true);
    expect(record.root).toBe(path.join(pluginsDir, 'test-plugin'));
    expect(record.dataDir).toBe(path.join(dataRoot, 'test-plugin'));
    expect(record.sourcePath).toBe(source);

    // ISO round-trip: `new Date(x).toISOString() === x` holds only for a
    // canonical ISO-8601 UTC instant.
    expect(new Date(record.installedAt).toISOString()).toBe(record.installedAt);
    expect(Date.parse(record.installedAt)).toBeGreaterThanOrEqual(before - 1);
    expect(Date.parse(record.installedAt)).toBeLessThanOrEqual(after + 1);

    expect(await lexists(path.join(record.root, 'plugin.json'))).toBe(true);
    expect(await lexists(path.join(record.root, 'skills', 'summarize', 'SKILL.md'))).toBe(true);
    expect(await lexists(path.join(record.root, 'mcp.json'))).toBe(true);
    expect(await lexists(path.join(record.root, 'LICENSE'))).toBe(true);

    // Copied, not merely touched.
    expect(await readOrNull(path.join(record.root, 'skills', 'summarize', 'SKILL.md'))).toBe(
      '# summarize',
    );
    const copiedManifest = JSON.parse(
      (await readOrNull(path.join(record.root, 'plugin.json'))) ?? 'null',
    );
    expect(copiedManifest).toMatchObject({ name: 'test-plugin', version: '1.2.0' });

    // The source is a copy source, not a move source.
    expect(await lexists(path.join(source, 'plugin.json'))).toBe(true);
  });

  it('returns a plugin describing the INSTALLED copy, not the source directory', async () => {
    // The whole reason for a managed store is that the installed root is
    // stable while a user-chosen source can move or be deleted. Anything ACK
    // writes into the agent's native MCP config — expanded ${PLUGIN_ROOT} and
    // ${PLUGIN_DATA} (§9.2), skill directories to fan out — must therefore
    // name the store, never the source. Only the store knows the §9.1 data
    // directory, so only the store can supply it to `loadPlugin`.
    await buildSource(source, {
      skills: ['summarize'],
      mcpServers: {
        stateful: {
          type: 'stdio',
          command: 'npx',
          args: ['--config', '${PLUGIN_ROOT}/config.json', '--state', '${PLUGIN_DATA}/db'],
        },
      },
    });

    const { record, plugin } = await store.install(source);

    expect(plugin.root).toBe(record.root);
    expect(plugin.root).not.toBe(source);
    expect(plugin.skills.map((s: PluginSkill) => s.dir)).toEqual([
      path.join(record.root, 'skills', 'summarize'),
    ]);
    expect(plugin.skills.map((s: PluginSkill) => s.skillFile)).toEqual([
      path.join(record.root, 'skills', 'summarize', 'SKILL.md'),
    ]);

    const server = plugin.mcpServers.find((s: PluginMcpServer) => s.name === 'stateful');
    expect(server).toMatchObject({
      type: 'stdio',
      args: ['--config', `${record.root}/config.json`, '--state', `${record.dataDir}/db`],
      cwd: record.root,
    });
  });
});

// ---------------------------------------------------------------------------
// PLUGIN_DATA (§9.1)
// ---------------------------------------------------------------------------

describe('PluginStore — PLUGIN_DATA (§9.1)', () => {
  it('creates the data directory and leaves it writable before install resolves', async () => {
    await buildSource(source);

    const { record } = await store.install(source);

    // "MUST create the directory before launching a plugin subprocess" — ACK
    // hands the path to the agent at install time, so it has to exist now.
    const stats = await statOrNull(record.dataDir);
    expect(stats?.isDirectory()).toBe(true);
    expect(record.dataDir).toBe(path.join(dataRoot, 'test-plugin'));

    // "MUST make it writable to that subprocess".
    const probe = path.join(record.dataDir, 'probe.txt');
    await fs.writeFile(probe, 'written by the plugin', 'utf-8');
    expect(await readOrNull(probe)).toBe('written by the plugin');

    // It is a data directory, not a second copy of the package.
    expect(await entries(record.dataDir)).toEqual(['probe.txt']);
  });

  it('preserves the data directory across a reinstall while replacing the root tree', async () => {
    // §9.1: the client "MUST preserve its contents across plugin updates".
    // DESIGN-phase2.md rule 3 makes this the store's headline requirement.
    await buildSource(source, {
      version: '1.0.0',
      skills: ['alpha'],
      files: { 'legacy.txt': 'shipped in v1 only' },
    });

    const first = await store.install(source);
    expect(await statOrNull(first.record.dataDir)).not.toBeNull();

    const sentinel = path.join(first.record.dataDir, 'state.json');
    await fs.writeFile(sentinel, '{"installedDeps":true}', 'utf-8');
    await fs.mkdir(path.join(first.record.dataDir, 'node_modules'), { recursive: true });

    // A genuine update: new version, an added skill, and a file that the new
    // package no longer ships.
    await fs.rm(source, { recursive: true, force: true });
    await buildSource(source, { version: '2.0.0', skills: ['alpha', 'beta'] });

    const second = await store.install(source);

    // (a) PLUGIN_DATA survived, same path and same contents.
    expect(second.record.dataDir).toBe(first.record.dataDir);
    expect(await readOrNull(sentinel)).toBe('{"installedDeps":true}');
    expect(await lexists(path.join(second.record.dataDir, 'node_modules'))).toBe(true);

    // (b) PLUGIN_ROOT was REPLACED, not merged: the v1-only file is gone.
    expect(second.record.root).toBe(first.record.root);
    expect(await lexists(path.join(second.record.root, 'skills', 'alpha', 'SKILL.md'))).toBe(true);
    expect(await lexists(path.join(second.record.root, 'skills', 'beta', 'SKILL.md'))).toBe(true);
    expect(await lexists(path.join(second.record.root, 'legacy.txt'))).toBe(false);

    // (c) The new manifest is what is installed and what is reported.
    expect(second.record.version).toBe('2.0.0');
    expect((await store.get('test-plugin'))?.version).toBe('2.0.0');

    // One plugin installed twice is still one plugin.
    expect(await entries(pluginsDir)).toEqual(['test-plugin']);
    expect(await entries(dataRoot)).toEqual(['test-plugin']);
  });
});

// ---------------------------------------------------------------------------
// Path containment during the copy (§4.1)
// ---------------------------------------------------------------------------

describe('PluginStore.install — symlink containment (§4.1)', () => {
  itSymlink('never lands a file symlinked from outside the source root in the store', async () => {
    // §4.1.3: "clients MUST reject package paths that resolve outside" the
    // plugin root. DESIGN-phase2.md rule 2 permits either skipping the entry
    // or rejecting the install, so this pins only the shared invariant: the
    // escaped target never appears in the store, whichever boundary is chosen.
    await buildSource(source, { skills: ['good'] });
    const secret = path.join(outside, 'secret.txt');
    await fs.writeFile(secret, 'not part of the package', 'utf-8');
    await fs.symlink(secret, path.join(source, 'vendor.txt'));

    const outcome = await settle(store.install(source));
    const root = path.join(pluginsDir, 'test-plugin');

    // Absent as a symlink AND absent as a dereferenced copy.
    expect(await lexists(path.join(root, 'vendor.txt'))).toBe(false);

    // Nothing was written through the link either.
    expect(await readOrNull(secret)).toBe('not part of the package');
    expect(await entries(outside)).toEqual(['secret.txt']);

    if (outcome.ok) {
      // Skip-the-entry: the rest of the package must still be installed.
      expect(await lexists(path.join(root, 'plugin.json'))).toBe(true);
      expect(await lexists(path.join(root, 'skills', 'good', 'SKILL.md'))).toBe(true);
    } else {
      // Reject-the-install: rule 1 still applies — nothing landed.
      expect(await ownedTrees()).toEqual({ plugins: [], data: [] });
    }
  });

  itSymlink('never lands a directory symlinked from outside the source root in the store', async () => {
    await buildSource(source, { skills: ['good'] });
    const escapee = path.join(outside, 'escapee');
    await fs.mkdir(escapee, { recursive: true });
    await fs.writeFile(path.join(escapee, 'SKILL.md'), '# escaped skill', 'utf-8');
    await fs.writeFile(path.join(escapee, 'payload.sh'), 'echo escaped', 'utf-8');
    await fs.symlink(escapee, path.join(source, 'skills', 'escapee'));

    const outcome = await settle(store.install(source));
    const root = path.join(pluginsDir, 'test-plugin');

    expect(await lexists(path.join(root, 'skills', 'escapee'))).toBe(false);
    expect(await lexists(path.join(root, 'skills', 'escapee', 'payload.sh'))).toBe(false);
    expect(await entries(outside)).toEqual(['escapee']);

    if (outcome.ok) {
      expect(await lexists(path.join(root, 'plugin.json'))).toBe(true);
      expect(await lexists(path.join(root, 'skills', 'good', 'SKILL.md'))).toBe(true);
      expect(await entries(path.join(root, 'skills'))).toEqual(['good']);
    } else {
      expect(await ownedTrees()).toEqual({ plugins: [], data: [] });
    }
  });
});

// ---------------------------------------------------------------------------
// uninstall — exactly the two owned subtrees, and nothing else
// ---------------------------------------------------------------------------

describe('PluginStore.uninstall', () => {
  it('removes both owned trees for that plugin and touches nothing else', async () => {
    await buildSource(source, { name: 'test-plugin' });
    const doomed = await store.install(source);

    const otherSource = path.join(outside, 'other-source');
    await buildSource(otherSource, { name: 'other-plugin', version: '3.1.0' });
    const survivor = await store.install(otherSource);

    // Per-plugin data that must survive an unrelated uninstall.
    expect(await statOrNull(doomed.record.dataDir)).not.toBeNull();
    expect(await statOrNull(survivor.record.dataDir)).not.toBeNull();
    await fs.writeFile(path.join(doomed.record.dataDir, 'doomed.txt'), 'goes away', 'utf-8');
    await fs.writeFile(path.join(survivor.record.dataDir, 'keep.txt'), 'must survive', 'utf-8');

    // Files the store does not own, sitting directly in each tree.
    await fs.writeFile(path.join(pluginsDir, 'ack.notes'), 'not a plugin', 'utf-8');
    await fs.writeFile(path.join(dataRoot, 'ack.notes'), 'not plugin data', 'utf-8');

    await store.uninstall('test-plugin');

    // DESIGN-phase2.md rule 4: delete the data directory too (§9.1 permits it).
    expect(await lexists(doomed.record.root)).toBe(false);
    expect(await lexists(doomed.record.dataDir)).toBe(false);

    // "never delete anything outside the two owned trees" — and nothing inside
    // them that belongs to another plugin.
    expect(await lexists(path.join(survivor.record.root, 'plugin.json'))).toBe(true);
    expect(await readOrNull(path.join(survivor.record.dataDir, 'keep.txt'))).toBe('must survive');
    expect(await readOrNull(path.join(pluginsDir, 'ack.notes'))).toBe('not a plugin');
    expect(await readOrNull(path.join(dataRoot, 'ack.notes'))).toBe('not plugin data');
    expect(await ownedTrees()).toEqual({
      plugins: ['ack.notes', 'other-plugin'],
      data: ['ack.notes', 'other-plugin'],
    });

    expect(await store.get('test-plugin')).toBeUndefined();
    expect((await store.list()).map((r: InstalledPluginRecord) => r.name)).toEqual([
      'other-plugin',
    ]);
  });

  it('does not throw and deletes nothing for a name that is not installed', async () => {
    await buildSource(source);
    const { record } = await store.install(source);
    expect(await statOrNull(record.dataDir)).not.toBeNull();
    await fs.writeFile(path.join(record.dataDir, 'keep.txt'), 'must survive', 'utf-8');

    await expect(store.uninstall('never-installed')).resolves.toBeUndefined();

    expect(await lexists(path.join(record.root, 'plugin.json'))).toBe(true);
    expect(await readOrNull(path.join(record.dataDir, 'keep.txt'))).toBe('must survive');
    expect(await ownedTrees()).toEqual({ plugins: ['test-plugin'], data: ['test-plugin'] });
  });
});

// ---------------------------------------------------------------------------
// list / get are derived from disk, never from a side index (DESIGN rule 5)
// ---------------------------------------------------------------------------

describe('PluginStore.list / get — derived from disk', () => {
  it('reports the version currently on disk, not one captured at install time', async () => {
    await buildSource(source, { version: '1.0.0' });
    const { record } = await store.install(source);
    expect(record.version).toBe('1.0.0');

    // Hand-edit the installed manifest: an index file written at install time
    // would now disagree with the package it claims to describe.
    const installedManifest = path.join(record.root, 'plugin.json');
    expect(await lexists(installedManifest)).toBe(true);
    const parsed = JSON.parse((await readOrNull(installedManifest)) ?? 'null');
    await fs.writeFile(
      installedManifest,
      JSON.stringify({ ...parsed, version: '9.9.9' }),
      'utf-8',
    );

    expect((await store.get('test-plugin'))?.version).toBe('9.9.9');
    expect((await store.list()).map((r: InstalledPluginRecord) => r.version)).toEqual(['9.9.9']);
  });

  it('starts empty, then lists what is installed, ignoring entries that are not plugins', async () => {
    expect(await store.list()).toEqual([]);
    expect(await store.get('test-plugin')).toBeUndefined();

    await buildSource(source, { name: 'test-plugin' });
    await store.install(source);

    const otherSource = path.join(outside, 'other-source');
    await buildSource(otherSource, { name: 'other-plugin' });
    await store.install(otherSource);

    // Junk that must not crash list(): an empty directory, a directory whose
    // plugin.json is unreadable, and a loose file.
    await fs.mkdir(path.join(pluginsDir, 'empty-dir'), { recursive: true });
    await writeInto(pluginsDir, path.join('broken', 'plugin.json'), '{ not json');
    await writeInto(pluginsDir, path.join('nameless', 'README.md'), 'no manifest at all');
    await fs.writeFile(path.join(pluginsDir, 'stray.txt'), 'loose file', 'utf-8');

    const listed = await store.list();
    expect(listed.map((r: InstalledPluginRecord) => r.name).sort()).toEqual([
      'other-plugin',
      'test-plugin',
    ]);
    for (const record of listed) {
      expect(record.root).toBe(path.join(pluginsDir, record.name));
      expect(record.dataDir).toBe(path.join(dataRoot, record.name));
    }

    expect(await store.get('broken')).toBeUndefined();
    expect(await store.get('empty-dir')).toBeUndefined();
    expect((await store.get('other-plugin'))?.root).toBe(path.join(pluginsDir, 'other-plugin'));
  });
});

// ---------------------------------------------------------------------------
// A name is never used unchecked as a path segment (§4.1, §5.5)
// ---------------------------------------------------------------------------

describe('PluginStore — a caller-supplied name never escapes the owned trees', () => {
  /**
   * §5.5 already bars `/` and `\` from a manifest name, so a traversal cannot
   * reach `install` through a valid manifest. `get` and `uninstall` take a
   * bare string from the caller, though, so they must re-check rather than
   * trusting it. DESIGN-phase2.md: "still join and re-check containment rather
   * than trusting it."
   */
  const escapeNames = (): string[] => [
    // Sideways out of the plugins tree.
    '../escape',
    // Across into the OTHER owned tree: a naive join would make this name
    // resolve to the installed plugin's PLUGIN_DATA directory.
    path.join('..', 'plugin-data', 'test-plugin'),
    // Fully absolute, which `path.resolve` would honour outright.
    path.join(outside, 'escape'),
  ];

  it('get() treats a traversal or absolute name as not installed', async () => {
    // Real, loadable plugin packages parked exactly where a naive
    // path.join / path.resolve of the name would find them.
    await buildSource(path.join(home, 'escape'), { name: 'escape', version: '6.6.6' });
    await buildSource(path.join(outside, 'escape'), { name: 'escape', version: '6.6.6' });

    await buildSource(source, { name: 'test-plugin' });
    await store.install(source);
    expect((await store.get('test-plugin'))?.name).toBe('test-plugin');

    for (const name of escapeNames()) {
      const outcome = await settle(store.get(name));
      // Rejecting is also acceptable; returning a record for something outside
      // the plugins tree is not.
      if (outcome.ok) {
        expect(outcome.value).toBeUndefined();
      }
    }

    // The out-of-tree packages are still where they were, unread and unmoved.
    expect(await lexists(path.join(home, 'escape', 'plugin.json'))).toBe(true);
    expect(await lexists(path.join(outside, 'escape', 'plugin.json'))).toBe(true);
    expect((await store.list()).map((r: InstalledPluginRecord) => r.name)).toEqual(['test-plugin']);
  });

  it('uninstall() with a traversal or absolute name deletes nothing outside the owned trees', async () => {
    await buildSource(path.join(home, 'escape'), { name: 'escape' });
    await buildSource(path.join(outside, 'escape'), { name: 'escape' });
    await fs.writeFile(path.join(outside, 'bystander.txt'), 'untouched', 'utf-8');

    await buildSource(source, { name: 'test-plugin' });
    const { record } = await store.install(source);
    expect(await statOrNull(record.dataDir)).not.toBeNull();
    await fs.writeFile(path.join(record.dataDir, 'keep.txt'), 'must survive', 'utf-8');

    for (const name of escapeNames()) {
      await settle(store.uninstall(name));
    }

    expect(await lexists(path.join(home, 'escape', 'plugin.json'))).toBe(true);
    expect(await lexists(path.join(outside, 'escape', 'plugin.json'))).toBe(true);
    expect(await readOrNull(path.join(outside, 'bystander.txt'))).toBe('untouched');

    // The installed plugin is untouched too: '../escape' is not a licence to
    // walk out of and back into the tree.
    expect(await lexists(path.join(record.root, 'plugin.json'))).toBe(true);
    expect(await readOrNull(path.join(record.dataDir, 'keep.txt'))).toBe('must survive');
    expect(await ownedTrees()).toEqual({ plugins: ['test-plugin'], data: ['test-plugin'] });
  });
});
