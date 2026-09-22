import { describe, it, expect } from 'vitest';
import { ProfileService } from '../../services/profile.service.js';
import { ProviderRegistry } from '../../providers/provider.registry.js';
import { createMockProvider } from './helpers/mock-provider.js';
import {
  DEFAULT_PROFILE_STORE,
  PROFILE_STORE_BACKUP_KEY,
  PROFILE_STORE_KEY,
} from '../../services/profile.types.js';

type CtorArgs = ConstructorParameters<typeof ProfileService>;

/** In-memory vscode.Memento stand-in, optionally pre-seeded. */
function fakeMemento(seed: Record<string, unknown> = {}): {
  memento: CtorArgs[0];
  store: Map<string, unknown>;
} {
  const store = new Map<string, unknown>(Object.entries(seed));
  const memento = {
    get(key: string, def?: unknown) {
      return store.has(key) ? store.get(key) : def;
    },
    update(key: string, value: unknown) {
      store.set(key, value);
      return Promise.resolve();
    },
    keys() {
      return [...store.keys()];
    },
  } as unknown as CtorArgs[0];
  return { memento, store };
}

function makeService(memento: CtorArgs[0], log: string[] = []): ProfileService {
  const registry = new ProviderRegistry();
  registry.register(createMockProvider()); // id 'mock'
  registry.setActiveProvider('mock');
  return new ProfileService(
    memento,
    { readAllTools: async () => [] } as unknown as CtorArgs[1],
    {} as unknown as CtorArgs[2],
    registry,
    {} as unknown as CtorArgs[4],
    { appendLine: (line: string) => log.push(line) } as unknown as CtorArgs[5],
  );
}

const VALID_PROFILE = {
  id: 'p-valid',
  name: 'Web',
  agentId: 'mock',
  tools: [{ key: 'skill:hello', enabled: true }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** One profile is missing `createdAt`, which fails the whole store schema. */
const CORRUPT_STORE = {
  version: 2,
  profiles: [
    VALID_PROFILE,
    { id: 'p-broken', name: 'Broken', agentId: 'mock', tools: [], updatedAt: '2026-01-01T00:00:00.000Z' },
  ],
  activeProfileId: 'p-valid',
};

describe('ProfileService — a store that fails validation', () => {
  it('keeps every valid profile readable', () => {
    const { memento } = fakeMemento({ [PROFILE_STORE_KEY]: CORRUPT_STORE });
    const svc = makeService(memento);

    expect(svc.getProfiles().map((p) => p.id)).toEqual(['p-valid']);
    expect(svc.getActiveProfileId()).toBe('p-valid');
  });

  it('does not wipe valid profiles on the next save', async () => {
    const { memento, store } = fakeMemento({ [PROFILE_STORE_KEY]: CORRUPT_STORE });
    const svc = makeService(memento);

    await svc.createProfile('New', []);

    const saved = store.get(PROFILE_STORE_KEY) as { profiles: Array<{ name: string }> };
    expect(saved.profiles.map((p) => p.name)).toEqual(['Web', 'New']);
  });

  it('saves the unreadable store under the backup key before overwriting it, and logs that', async () => {
    const { memento, store } = fakeMemento({ [PROFILE_STORE_KEY]: CORRUPT_STORE });
    const log: string[] = [];
    const svc = makeService(memento, log);

    await svc.createProfile('New', []);

    const backups = store.get(PROFILE_STORE_BACKUP_KEY) as Array<{ savedAt: string; store: unknown }>;
    expect(backups).toHaveLength(1);
    expect(backups[0].store).toEqual(CORRUPT_STORE);
    expect(typeof backups[0].savedAt).toBe('string');
    expect(log.some((line) => line.includes(PROFILE_STORE_BACKUP_KEY))).toBe(true);
  });

  it('never mutates the shared default store', async () => {
    const { memento } = fakeMemento({ [PROFILE_STORE_KEY]: 'not a store' });
    const svc = makeService(memento);

    await svc.createProfile('New', []);

    expect(DEFAULT_PROFILE_STORE.profiles).toEqual([]);
  });

  it('writes no backup when the stored value was valid', async () => {
    const { memento, store } = fakeMemento({
      [PROFILE_STORE_KEY]: { version: 2, profiles: [VALID_PROFILE], activeProfileId: null },
    });
    const svc = makeService(memento);

    await svc.createProfile('New', []);

    expect(store.has(PROFILE_STORE_BACKUP_KEY)).toBe(false);
  });

  it('writes no backup when no store existed yet', async () => {
    const { memento, store } = fakeMemento();
    const svc = makeService(memento);

    await svc.createProfile('First', []);

    expect(store.has(PROFILE_STORE_BACKUP_KEY)).toBe(false);
    expect(DEFAULT_PROFILE_STORE.profiles).toEqual([]);
  });
});
