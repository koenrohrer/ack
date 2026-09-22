import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { loadPlugin } from '../../plugins/plugin.loader.js';
import type {
  AgentPlugin,
  PluginDiagnostic,
  PluginLoadResult,
  PluginMcpServer,
  PluginSkill,
} from '../../types/plugin.js';

/**
 * Agent Plugins 1.0.0 — end-to-end loader behaviour: §5 manifest, §6 component
 * discovery, §7 component types, §11.3 resilience.
 *
 * Canonical identifiers are quoted verbatim from §5.2 / §7.2.1; they are
 * normative constants of the format, not values observed from a run.
 */

const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';

let root: string;
let outside: string;
/**
 * The client-managed PLUGIN_DATA directory. Deliberately created as a sibling
 * of the plugin root, never beneath it: §9.1 requires PLUGIN_DATA to survive
 * plugin updates, and the root is exactly what an update replaces. Asserting on
 * this path therefore also pins "not derived from the plugin root".
 */
let pluginData: string;

const itSymlink = process.platform === 'win32' ? it.skip : it;

beforeEach(async () => {
  // realpath(): on macOS os.tmpdir() is itself a symlink, which would make
  // every containment answer wrong by accident.
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-loader-root-')));
  outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-loader-out-')));
  pluginData = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-loader-data-')));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
  await fs.rm(pluginData, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

async function write(rel: string, content: string): Promise<string> {
  const full = path.join(root, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf-8');
  return full;
}

async function mkdir(rel: string): Promise<string> {
  const full = path.join(root, rel);
  await fs.mkdir(full, { recursive: true });
  return full;
}

/** A conforming manifest with `overrides` merged over the required fields. */
function manifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ $schema: PLUGIN_SCHEMA, name: 'test-plugin', ...overrides });
}

/** A raw manifest written exactly as given (for malformed-input cases). */
function writeManifest(overrides: Record<string, unknown> = {}): Promise<string> {
  return write('plugin.json', manifest(overrides));
}

function mcpConfig(servers: Record<string, unknown>, schema: string = MCP_SCHEMA): string {
  return JSON.stringify({ $schema: schema, mcpServers: servers });
}

/**
 * A diagnostic identifies the component it concerns either through `subject` or
 * by naming it in the message. Asserting on identification rather than on the
 * exact English prose keeps the test from breaking on wording changes.
 */
function identifies(d: { subject?: string; message: string }, subject: string): boolean {
  return d.subject === subject || d.message.includes(subject);
}

function expectOk(result: PluginLoadResult): AgentPlugin {
  if (!result.ok) {
    throw new Error(
      `expected the plugin to load, but it was rejected: ${JSON.stringify(result.diagnostics)}`,
    );
  }
  return result.plugin;
}

function expectRejected(result: PluginLoadResult): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    return;
  }
  // §5.3 / §11.3.2: the client SHOULD report which field is invalid.
  expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
}

// ---------------------------------------------------------------------------
// Manifest — fatal rejections (§5.1, §5.2, §5.3, §5.5)
// ---------------------------------------------------------------------------

describe('loadPlugin — fatal manifest failures', () => {
  it('rejects a directory with no plugin.json', async () => {
    expectRejected(await loadPlugin(root));
  });

  it('rejects a plugin.json that is not valid JSON', async () => {
    await write('plugin.json', '{ "name": ');
    expectRejected(await loadPlugin(root));
  });

  it('rejects a plugin.json whose top level is an array', async () => {
    await write('plugin.json', '[]');
    expectRejected(await loadPlugin(root));
  });

  it('rejects a plugin.json whose top level is a string', async () => {
    await write('plugin.json', '"test-plugin"');
    expectRejected(await loadPlugin(root));
  });

  it('rejects a plugin.json whose top level is null', async () => {
    await write('plugin.json', 'null');
    expectRejected(await loadPlugin(root));
  });

  it('rejects a manifest with no $schema', async () => {
    await write('plugin.json', JSON.stringify({ name: 'test-plugin' }));
    expectRejected(await loadPlugin(root));
  });

  it('rejects a manifest declaring an unsupported $schema version', async () => {
    await write(
      'plugin.json',
      JSON.stringify({
        $schema: 'https://agent-plugins.org/schemas/2.0.0/plugin.schema.json',
        name: 'test-plugin',
      }),
    );
    expectRejected(await loadPlugin(root));
  });

  it('rejects a manifest whose $schema is the MCP schema id', async () => {
    await write('plugin.json', JSON.stringify({ $schema: MCP_SCHEMA, name: 'test-plugin' }));
    expectRejected(await loadPlugin(root));
  });

  it('rejects a manifest with no name', async () => {
    await write('plugin.json', JSON.stringify({ $schema: PLUGIN_SCHEMA }));
    expectRejected(await loadPlugin(root));
  });

  it('rejects a manifest whose name is the empty string', async () => {
    await writeManifest({ name: '' });
    expectRejected(await loadPlugin(root));
  });

  it('rejects a manifest whose name is not a string', async () => {
    await writeManifest({ name: 42 });
    expectRejected(await loadPlugin(root));
  });

  it('rejects a manifest whose name violates the §5.5 constraints', async () => {
    await writeManifest({ name: 'My-Plugin' });
    expectRejected(await loadPlugin(root));
  });

  it('rejects a wrong-typed keywords field', async () => {
    await writeManifest({ keywords: 'a' });
    expectRejected(await loadPlugin(root));
  });

  it('rejects a keywords array containing a non-string', async () => {
    await writeManifest({ keywords: ['ok', 7] });
    expectRejected(await loadPlugin(root));
  });

  it('rejects a wrong-typed version field', async () => {
    await writeManifest({ version: 1.2 });
    expectRejected(await loadPlugin(root));
  });

  it('rejects a wrong-typed description field', async () => {
    await writeManifest({ description: ['a'] });
    expectRejected(await loadPlugin(root));
  });

  it('rejects a wrong-typed license field', async () => {
    await writeManifest({ license: 42 });
    expectRejected(await loadPlugin(root));
  });

  it('rejects a non-object author', async () => {
    await writeManifest({ author: 42 });
    expectRejected(await loadPlugin(root));
  });

  it('rejects an author containing a field other than name/email/url', async () => {
    await writeManifest({ author: { name: 'A', twitter: '@a' } });
    expectRejected(await loadPlugin(root));
  });

  it('rejects a non-string author.name', async () => {
    await writeManifest({ author: { name: 42 } });
    expectRejected(await loadPlugin(root));
  });

  it('rejects a non-string author.email', async () => {
    await writeManifest({ author: { email: ['a@example.com'] } });
    expectRejected(await loadPlugin(root));
  });

  it('discovers no components at all when the manifest is fatal', async () => {
    // §5.2: "the client MUST reject the plugin and MUST NOT discover or execute
    // any of its components."
    await writeManifest({ keywords: 'a' });
    await write('skills/good/SKILL.md', '# good');
    await write('mcp.json', mcpConfig({ srv: { type: 'stdio', command: 'npx' } }));

    const result = await loadPlugin(root);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('plugin');
  });
});

// ---------------------------------------------------------------------------
// Manifest — non-fatal exceptions (§5.2, §8.1, §11.3.2)
// ---------------------------------------------------------------------------

describe('loadPlugin — non-fatal manifest exceptions', () => {
  it('reports and ignores an unknown top-level field but still loads the plugin', async () => {
    await writeManifest({ experimentalThing: { enabled: true } });

    const plugin = expectOk(await loadPlugin(root));

    expect(plugin.manifest.name).toBe('test-plugin');
    expect('experimentalThing' in plugin.manifest).toBe(false);
    expect(plugin.diagnostics.filter((d: PluginDiagnostic) =>identifies(d, 'experimentalThing'))).toHaveLength(1);
  });

  it('reports each unknown top-level field separately', async () => {
    await writeManifest({ alpha: 1, beta: 2 });

    const plugin = expectOk(await loadPlugin(root));

    expect(plugin.diagnostics).toHaveLength(2);
    expect(plugin.diagnostics.filter((d: PluginDiagnostic) =>identifies(d, 'alpha'))).toHaveLength(1);
    expect(plugin.diagnostics.filter((d: PluginDiagnostic) =>identifies(d, 'beta'))).toHaveLength(1);
  });

  it('still discovers components when an unknown top-level field is present', async () => {
    await writeManifest({ experimentalThing: true });
    await write('skills/summarize/SKILL.md', '# summarize');

    const plugin = expectOk(await loadPlugin(root));
    expect(plugin.skills.map((s: PluginSkill) =>s.name)).toEqual(['summarize']);
  });

  it('reports and ignores a non-object extensions field but still loads the plugin (§8.1)', async () => {
    await writeManifest({ extensions: 'not-an-object' });

    const plugin = expectOk(await loadPlugin(root));

    expect(plugin.manifest.name).toBe('test-plugin');
    expect(plugin.manifest.extensions).toBeUndefined();
    expect(plugin.diagnostics.filter((d: PluginDiagnostic) =>identifies(d, 'extensions'))).toHaveLength(1);
  });

  it('reports and ignores an extensions array', async () => {
    await writeManifest({ extensions: ['com.example.client'] });

    const plugin = expectOk(await loadPlugin(root));
    expect(plugin.manifest.extensions).toBeUndefined();
    expect(plugin.diagnostics).toHaveLength(1);
  });

  it('reports both an unknown field and a non-object extensions in one load', async () => {
    await writeManifest({ experimentalThing: 1, extensions: 7 });

    const plugin = expectOk(await loadPlugin(root));
    expect(plugin.diagnostics).toHaveLength(2);
  });

  it('never validates the contents of extensions namespace values (§8.1, §11.1.3)', async () => {
    const extensions = {
      'com.example.client': { setting: true, nested: { deep: [1, 'two', null] } },
      'org.unknown.tool': { anything: 'goes', count: -1 },
    };
    await writeManifest({ extensions });

    const plugin = expectOk(await loadPlugin(root));

    expect(plugin.diagnostics).toEqual([]);
    expect(plugin.manifest.extensions).toEqual(extensions);
  });

  it('rejects extensions whose namespace value is not an object', async () => {
    // §8.1 constrains member values to objects; only a non-object `extensions`
    // itself is granted the non-fatal exception.
    await writeManifest({ extensions: { 'com.example.client': 'nope' } });
    expectRejected(await loadPlugin(root));
  });
});

// ---------------------------------------------------------------------------
// Metadata is validated by JSON type only (§5.4)
// ---------------------------------------------------------------------------

describe('loadPlugin — metadata validated by JSON type only (§5.4)', () => {
  it('loads a manifest whose metadata strings are semantically meaningless', async () => {
    await writeManifest({
      version: 'banana',
      license: 'whatever',
      homepage: 'not a url',
      repository: 'also not a url',
      author: { name: 'A', email: 'definitely-not-an-email', url: 'nope://' },
      keywords: [],
    });

    const plugin = expectOk(await loadPlugin(root));

    expect(plugin.diagnostics).toEqual([]);
    expect(plugin.manifest).toMatchObject({
      name: 'test-plugin',
      version: 'banana',
      license: 'whatever',
      homepage: 'not a url',
      repository: 'also not a url',
      author: { name: 'A', email: 'definitely-not-an-email', url: 'nope://' },
      keywords: [],
    });
  });

  it('never retrieves the schema over the network while loading (§5.2)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network access is forbidden while loading a plugin'));
    try {
      await writeManifest();
      const plugin = expectOk(await loadPlugin(root));
      expect(plugin.manifest.name).toBe('test-plugin');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('records the filesystem-resolved plugin root', async () => {
    await writeManifest();
    const plugin = expectOk(await loadPlugin(root));
    expect(plugin.root).toBe(root);
  });
});

// ---------------------------------------------------------------------------
// Skills discovery (§6.1, §6.2, §7.1)
// ---------------------------------------------------------------------------

describe('loadPlugin — skills discovery', () => {
  it('reports zero skills and no diagnostic when skills/ is absent (§6.2)', async () => {
    await writeManifest();

    const plugin = expectOk(await loadPlugin(root));
    expect(plugin.skills).toEqual([]);
    expect(plugin.diagnostics).toEqual([]);
  });

  it('discovers each immediate child directory containing SKILL.md', async () => {
    await writeManifest();
    await write('skills/summarize/SKILL.md', '# summarize');
    await write('skills/deploy/SKILL.md', '# deploy');

    const plugin = expectOk(await loadPlugin(root));

    expect(plugin.skills.map((s: PluginSkill) =>s.name).sort()).toEqual(['deploy', 'summarize']);
    const summarize = plugin.skills.find((s: PluginSkill) =>s.name === 'summarize')!;
    expect(summarize.dir).toBe(path.join(root, 'skills', 'summarize'));
    expect(summarize.skillFile).toBe(path.join(root, 'skills', 'summarize', 'SKILL.md'));
    expect(plugin.diagnostics).toEqual([]);
  });

  it('does NOT recurse — skills/a/b/SKILL.md is not a skill (§7.1)', async () => {
    await writeManifest();
    await write('skills/a/b/SKILL.md', '# nested');

    const plugin = expectOk(await loadPlugin(root));

    expect(plugin.skills.map((s: PluginSkill) =>s.name)).toEqual([]);
  });

  it('does NOT recurse into a valid skill to find deeper SKILL.md files (§7.1)', async () => {
    await writeManifest();
    await write('skills/a/SKILL.md', '# a');
    await write('skills/a/b/SKILL.md', '# a/b — must be ignored');
    await write('skills/a/references/c/SKILL.md', '# deeper — must be ignored');

    const plugin = expectOk(await loadPlugin(root));

    expect(plugin.skills.map((s: PluginSkill) =>s.name)).toEqual(['a']);
    expect(plugin.skills[0].skillFile).toBe(path.join(root, 'skills', 'a', 'SKILL.md'));
  });

  it('skips a skill directory that has no SKILL.md and reports it', async () => {
    await writeManifest();
    await write('skills/good/SKILL.md', '# good');
    await mkdir('skills/incomplete');

    const plugin = expectOk(await loadPlugin(root));

    expect(plugin.skills.map((s: PluginSkill) =>s.name)).toEqual(['good']);
    expect(plugin.diagnostics.filter((d: PluginDiagnostic) =>identifies(d, 'incomplete'))).toHaveLength(1);
  });

  it('skips a skill directory whose SKILL.md is a directory, not a regular file (§7.1)', async () => {
    await writeManifest();
    await write('skills/good/SKILL.md', '# good');
    await mkdir('skills/weird/SKILL.md');

    const plugin = expectOk(await loadPlugin(root));

    expect(plugin.skills.map((s: PluginSkill) =>s.name)).toEqual(['good']);
  });

  it('ignores a loose file directly under skills/', async () => {
    await writeManifest();
    await write('skills/README.md', 'not a skill');
    await write('skills/good/SKILL.md', '# good');

    const plugin = expectOk(await loadPlugin(root));

    expect(plugin.skills.map((s: PluginSkill) =>s.name)).toEqual(['good']);
  });

  it('is case-sensitive about the SKILL.md filename', async () => {
    await writeManifest();
    await write('skills/lower/skill.md', '# lower-case name');

    const plugin = expectOk(await loadPlugin(root));
    expect(plugin.skills.map((s: PluginSkill) =>s.name)).toEqual([]);
  });

  it('treats a non-directory skills/ as an invalid component type but keeps loading others (§6.2)', async () => {
    await writeManifest();
    await write('skills', 'this is a file, not a directory');
    await write('mcp.json', mcpConfig({ srv: { type: 'stdio', command: 'npx' } }));

    const plugin = expectOk(await loadPlugin(root));

    expect(plugin.skills).toEqual([]);
    expect(plugin.mcpServers.map((s: PluginMcpServer) =>s.name)).toEqual(['srv']);
    expect(plugin.diagnostics).toHaveLength(1);
  });

  itSymlink('skips a skill whose directory symlinks outside the plugin root (§4.1)', async () => {
    await writeManifest();
    await write('skills/good/SKILL.md', '# good');
    const target = path.join(outside, 'escapee');
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'SKILL.md'), '# escaped', 'utf-8');
    await fs.symlink(target, path.join(root, 'skills', 'escapee'));

    const plugin = expectOk(await loadPlugin(root));

    expect(plugin.skills.map((s: PluginSkill) =>s.name)).toEqual(['good']);
    expect(plugin.diagnostics.filter((d: PluginDiagnostic) =>identifies(d, 'escapee'))).toHaveLength(1);
  });

  itSymlink('skips a skill whose SKILL.md symlinks outside the plugin root (§4.1)', async () => {
    await writeManifest();
    const target = path.join(outside, 'SKILL.md');
    await fs.writeFile(target, '# escaped', 'utf-8');
    await mkdir('skills/escapee');
    await fs.symlink(target, path.join(root, 'skills', 'escapee', 'SKILL.md'));

    const plugin = expectOk(await loadPlugin(root));

    expect(plugin.skills.map((s: PluginSkill) =>s.name)).toEqual([]);
    expect(plugin.diagnostics.filter((d: PluginDiagnostic) =>identifies(d, 'escapee'))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// MCP discovery through the loader (§6.2, §7.2.2, §10.1)
// ---------------------------------------------------------------------------

describe('loadPlugin — MCP configuration', () => {
  it('reports zero servers and no diagnostic when mcp.json is absent (§6.2)', async () => {
    await writeManifest();

    const plugin = expectOk(await loadPlugin(root));
    expect(plugin.mcpServers).toEqual([]);
    expect(plugin.diagnostics).toEqual([]);
  });

  it('loads the servers declared in mcp.json', async () => {
    await writeManifest();
    await write(
      'mcp.json',
      mcpConfig({
        local: { type: 'stdio', command: 'npx', args: ['--config', '${PLUGIN_ROOT}/db.json'] },
        remote: { type: 'streamable-http', url: 'https://example.com/mcp' },
      }),
    );

    const plugin = expectOk(await loadPlugin(root));

    expect(plugin.diagnostics).toEqual([]);
    expect(plugin.mcpServers.map((s: PluginMcpServer) =>s.name).sort()).toEqual(['local', 'remote']);
    expect(plugin.mcpServers.find((s: PluginMcpServer) =>s.name === 'local')).toMatchObject({
      type: 'stdio',
      command: 'npx',
      args: ['--config', `${root}/db.json`],
      cwd: root,
    });
  });

  it('treats a non-regular-file mcp.json as an invalid component type but keeps skills (§6.2)', async () => {
    await writeManifest();
    await write('skills/good/SKILL.md', '# good');
    await mkdir('mcp.json');

    const plugin = expectOk(await loadPlugin(root));

    expect(plugin.mcpServers).toEqual([]);
    expect(plugin.skills.map((s: PluginSkill) =>s.name)).toEqual(['good']);
    expect(plugin.diagnostics).toHaveLength(1);
  });

  it('disables MCP but still loads skills when mcp.json is not valid JSON (§7.2.2.2)', async () => {
    await writeManifest();
    await write('skills/good/SKILL.md', '# good');
    await write('mcp.json', '{ "mcpServers": ');

    const plugin = expectOk(await loadPlugin(root));

    expect(plugin.mcpServers).toEqual([]);
    expect(plugin.skills.map((s: PluginSkill) =>s.name)).toEqual(['good']);
    expect(plugin.diagnostics).toHaveLength(1);
  });

  it('disables MCP but still loads skills when mcp.json declares a different version than plugin.json (§10.1)', async () => {
    await writeManifest();
    await write('skills/good/SKILL.md', '# good');
    await write(
      'mcp.json',
      mcpConfig(
        { srv: { type: 'stdio', command: 'npx' } },
        'https://agent-plugins.org/schemas/1.1.0/mcp.schema.json',
      ),
    );

    const plugin = expectOk(await loadPlugin(root));

    expect(plugin.mcpServers).toEqual([]);
    expect(plugin.skills.map((s: PluginSkill) =>s.name)).toEqual(['good']);
    expect(plugin.diagnostics).toHaveLength(1);
  });

  it('disables MCP but still loads skills when mcp.json has an extra top-level field (§7.2.2.2)', async () => {
    await writeManifest();
    await write('skills/good/SKILL.md', '# good');
    await write(
      'mcp.json',
      JSON.stringify({ $schema: MCP_SCHEMA, mcpServers: {}, defaultTimeout: 30 }),
    );

    const plugin = expectOk(await loadPlugin(root));

    expect(plugin.mcpServers).toEqual([]);
    expect(plugin.skills.map((s: PluginSkill) =>s.name)).toEqual(['good']);
    expect(plugin.diagnostics).toHaveLength(1);
  });

  it('expands ${PLUGIN_DATA} from the caller-supplied data directory, not from the plugin root', async () => {
    // §9.1: PLUGIN_DATA is a client-managed directory that persists across
    // plugin updates. `pluginData` is a sibling of the root, so an
    // implementation that derived it from the root would fail these assertions.
    await writeManifest();
    await write(
      'mcp.json',
      mcpConfig({
        srv: {
          type: 'stdio',
          command: 'npx',
          args: ['--state', '${PLUGIN_DATA}/db'],
          env: { CACHE: '${PLUGIN_DATA}/cache', CONFIG: '${PLUGIN_ROOT}/config.json' },
          cwd: '${PLUGIN_DATA}',
        },
      }),
    );

    const plugin = expectOk(await loadPlugin(root, { pluginData }));

    expect(plugin.diagnostics).toEqual([]);
    expect(plugin.mcpServers).toHaveLength(1);
    expect(plugin.mcpServers[0]).toMatchObject({
      name: 'srv',
      type: 'stdio',
      args: ['--state', `${pluginData}/db`],
      env: expect.objectContaining({
        CACHE: `${pluginData}/cache`,
        CONFIG: `${root}/config.json`,
      }),
      cwd: pluginData,
    });
  });

  it('skips every entry referencing ${PLUGIN_DATA} when no data directory is supplied', async () => {
    // With no PLUGIN_DATA available the reference cannot be resolved, so those
    // entries are invalid under §7.2.2.3 — a per-entry boundary, not a
    // whole-file one: the clean server and the skill must still load.
    await writeManifest();
    await write('skills/good/SKILL.md', '# good');
    await write(
      'mcp.json',
      mcpConfig({
        clean: { type: 'stdio', command: 'npx', args: ['${PLUGIN_ROOT}/x'] },
        'via-args': { type: 'stdio', command: 'npx', args: ['--state', '${PLUGIN_DATA}/db'] },
        'via-env': { type: 'stdio', command: 'npx', env: { STATE: '${PLUGIN_DATA}/db' } },
        'via-cwd': { type: 'stdio', command: 'npx', cwd: '${PLUGIN_DATA}' },
      }),
    );

    const plugin = expectOk(await loadPlugin(root));

    expect(plugin.mcpServers.map((s: PluginMcpServer) => s.name)).toEqual(['clean']);
    expect(plugin.mcpServers[0]).toMatchObject({ args: [`${root}/x`], cwd: root });
    expect(plugin.skills.map((s: PluginSkill) => s.name)).toEqual(['good']);

    expect(plugin.diagnostics).toHaveLength(3);
    for (const name of ['via-args', 'via-env', 'via-cwd']) {
      expect(
        plugin.diagnostics.filter((d: PluginDiagnostic) => identifies(d, name)),
      ).toHaveLength(1);
    }
  });

  it('skips only the invalid server entry and keeps its valid sibling (§7.2.2.3)', async () => {
    await writeManifest();
    await write(
      'mcp.json',
      mcpConfig({
        good: { type: 'streamable-http', url: 'https://example.com/mcp' },
        bad: { type: 'stdio', command: 'npx', env: { PLUGIN_ROOT: '/tmp' } },
      }),
    );

    const plugin = expectOk(await loadPlugin(root));

    expect(plugin.mcpServers.map((s: PluginMcpServer) =>s.name)).toEqual(['good']);
    expect(plugin.diagnostics.filter((d: PluginDiagnostic) =>identifies(d, 'bad'))).toHaveLength(1);
    expect(plugin.diagnostics).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Resilience (§11.3.3)
// ---------------------------------------------------------------------------

describe('loadPlugin — resilience', () => {
  it('loads independently valid components alongside two isolated failures', async () => {
    await writeManifest({ version: '1.2.0' });
    await write('skills/good/SKILL.md', '# good skill');
    await mkdir('skills/incomplete'); // no SKILL.md -> skipped + reported
    await write(
      'mcp.json',
      mcpConfig({
        'good-server': { type: 'stdio', command: 'npx', args: ['${PLUGIN_ROOT}/x'] },
        'bad-server': { type: 'stdio', command: 'npx', cwd: 'data' }, // bare cwd -> invalid
      }),
    );

    const plugin = expectOk(await loadPlugin(root));

    expect(plugin.manifest.name).toBe('test-plugin');
    expect(plugin.skills.map((s: PluginSkill) =>s.name)).toEqual(['good']);
    expect(plugin.mcpServers.map((s: PluginMcpServer) =>s.name)).toEqual(['good-server']);
    expect(plugin.mcpServers[0]).toMatchObject({
      type: 'stdio',
      command: 'npx',
      args: [`${root}/x`],
    });
    expect(plugin.diagnostics).toHaveLength(2);
    expect(plugin.diagnostics.filter((d: PluginDiagnostic) =>identifies(d, 'incomplete'))).toHaveLength(1);
    expect(plugin.diagnostics.filter((d: PluginDiagnostic) =>identifies(d, 'bad-server'))).toHaveLength(1);
  });

  it('ignores component types outside the v1 format (§7, §11.3.1)', async () => {
    // commands/, hooks/, agents/ are not v1 component types: present but inert.
    await writeManifest();
    await write('skills/good/SKILL.md', '# good');
    await write('commands/deploy.md', '# not a v1 component');
    await write('hooks/hooks.json', '{}');
    await write('agents/reviewer.md', '# not a v1 component');
    await write('com.example.client/hooks/hooks.json', '{}');

    const plugin = expectOk(await loadPlugin(root));

    expect(plugin.skills.map((s: PluginSkill) =>s.name)).toEqual(['good']);
    expect(plugin.mcpServers).toEqual([]);
    expect(plugin.diagnostics).toEqual([]);
  });
});
