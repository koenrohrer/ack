import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * `PluginStore.install` must load the staged copy before it replaces the
 * installed root. A package that validates at its source but fails to load
 * once copied cannot be built from a real directory -- the loader rejects the
 * escaping links that would cause it -- so this file forces the staged load to
 * fail and checks that the installed version survives.
 */
const forced = vi.hoisted(() => ({ failStagedLoad: false }));

vi.mock('../../plugins/plugin.loader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../plugins/plugin.loader.js')>();
  return {
    ...actual,
    loadPlugin: async (...args: Parameters<typeof actual.loadPlugin>) => {
      if (forced.failStagedLoad && args[0].includes('.staging-')) {
        return {
          ok: false as const,
          diagnostics: [{ severity: 'error' as const, section: '5.2', message: 'forced staged-load failure' }],
        };
      }
      return actual.loadPlugin(...args);
    },
  };
});

import { PluginStore } from '../../plugins/plugin.store.js';

const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';

let home: string;
let source: string;
let pluginsDir: string;
let store: PluginStore;

async function writePackage(dir: string, version: string, extra: Record<string, string>): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'plugin.json'),
    JSON.stringify({ $schema: PLUGIN_SCHEMA, name: 'test-plugin', version }),
  );
  for (const [rel, content] of Object.entries(extra)) {
    await fs.writeFile(path.join(dir, rel), content);
  }
}

beforeEach(async () => {
  forced.failStagedLoad = false;
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-staging-home-')));
  source = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-staging-src-')));
  pluginsDir = path.join(home, 'plugins');
  store = new PluginStore(pluginsDir, path.join(home, 'plugin-data'));
});

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(source, { recursive: true, force: true });
});

describe('PluginStore.install — staged load failure', () => {
  it('keeps the installed version and leaves no staging directory behind', async () => {
    await writePackage(source, '1.0.0', { 'v1.txt': 'one' });
    const first = await store.install(source);

    await fs.rm(source, { recursive: true, force: true });
    await writePackage(source, '2.0.0', { 'v2.txt': 'two' });
    forced.failStagedLoad = true;

    await expect(store.install(source)).rejects.toThrow(/forced staged-load failure/);

    forced.failStagedLoad = false;
    expect((await store.get('test-plugin'))?.version).toBe('1.0.0');
    expect(await fs.readFile(path.join(first.record.root, 'v1.txt'), 'utf-8')).toBe('one');
    expect((await fs.readdir(pluginsDir)).sort()).toEqual(['test-plugin']);
  });
});
