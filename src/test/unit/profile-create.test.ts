import { describe, it, expect } from 'vitest';
import { ProfileService } from '../../services/profile.service.js';
import { ProviderRegistry } from '../../providers/provider.registry.js';
import { createMockProvider } from './helpers/mock-provider.js';
import { ToolType, ConfigScope, ToolStatus } from '../../types/enums.js';
import { canonicalKey } from '../../utils/tool-key.utils.js';
import type { NormalizedTool } from '../../types/config.js';
import type { ProfileToolEntry } from '../../services/profile.types.js';

type CtorArgs = ConstructorParameters<typeof ProfileService>;

/** In-memory vscode.Memento stand-in. */
function fakeMemento(): CtorArgs[0] {
  const store = new Map<string, unknown>();
  return {
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
}

function mk(type: ToolType, name: string, scope: ConfigScope, status: ToolStatus): NormalizedTool {
  return { id: `${type}:${scope}:${name}`, type, name, scope, status, source: { filePath: `/x/${name}` }, metadata: {} };
}

function makeService(readAllTools: (type: ToolType) => Promise<NormalizedTool[]>): ProfileService {
  const registry = new ProviderRegistry();
  registry.register(createMockProvider()); // id 'mock'
  registry.setActiveProvider('mock');
  const configService = { readAllTools } as unknown as CtorArgs[1];
  return new ProfileService(
    fakeMemento(),
    configService,
    {} as unknown as CtorArgs[2],
    registry,
    {} as unknown as CtorArgs[4],
  );
}

describe('ProfileService.createProfile — tool selection', () => {
  it('records an explicit selection verbatim and does NOT snapshot', async () => {
    const entries: ProfileToolEntry[] = [
      { key: 'mcp_server:github', enabled: true },
      { key: 'skill:writer', enabled: false },
      { key: 'mcp_server:time', enabled: true },
    ];
    const svc = makeService(async () => {
      throw new Error('snapshot path must not run when entries are provided');
    });

    const profile = await svc.createProfile('Preset A', entries);

    expect(profile.tools).toEqual(entries);
    expect(profile.agentId).toBe('mock');
    // Persisted to the store, readable back.
    expect(svc.getProfile(profile.id)?.tools).toEqual(entries);
  });

  it('supports a complete-preset shape: some enabled, the rest disabled', async () => {
    // Mirrors what the command builds: an entry for EVERY tool, picked -> enabled.
    const entries: ProfileToolEntry[] = [
      { key: 'skill:hello', enabled: true },
      { key: 'mcp_server:github', enabled: true },
      { key: 'command:greet', enabled: false },
      { key: 'custom_prompt:review', enabled: false },
    ];
    const svc = makeService(async () => []);

    const profile = await svc.createProfile('Curated', entries);

    expect(profile.tools.filter((e) => e.enabled).map((e) => e.key)).toEqual([
      'skill:hello',
      'mcp_server:github',
    ]);
    expect(profile.tools.filter((e) => !e.enabled).map((e) => e.key)).toEqual([
      'command:greet',
      'custom_prompt:review',
    ]);
  });

  it('falls back to snapshotting current state when no entries are given', async () => {
    const byType: Partial<Record<ToolType, NormalizedTool[]>> = {
      [ToolType.Skill]: [mk(ToolType.Skill, 'writer', ConfigScope.User, ToolStatus.Enabled)],
      [ToolType.McpServer]: [
        mk(ToolType.McpServer, 'github', ConfigScope.User, ToolStatus.Disabled),
        mk(ToolType.McpServer, 'pinned', ConfigScope.Managed, ToolStatus.Enabled), // excluded
      ],
    };
    const svc = makeService(async (type) => byType[type] ?? []);

    const profile = await svc.createProfile('Snapshot');

    expect(profile.tools).toContainEqual({
      key: canonicalKey(mk(ToolType.Skill, 'writer', ConfigScope.User, ToolStatus.Enabled)),
      enabled: true,
    });
    expect(profile.tools).toContainEqual({
      key: canonicalKey(mk(ToolType.McpServer, 'github', ConfigScope.User, ToolStatus.Disabled)),
      enabled: false,
    });
    // Managed-scope tools are never captured in a profile.
    const managedKey = canonicalKey(mk(ToolType.McpServer, 'pinned', ConfigScope.Managed, ToolStatus.Enabled));
    expect(profile.tools.some((e) => e.key === managedKey)).toBe(false);
  });
});

describe('ProfileService.updateProfile — editing tools', () => {
  it('rewrites a profile as a complete preset, capturing a tool added after creation', async () => {
    const svc = makeService(async () => []);

    // Profile created when only two tools were known.
    const created = await svc.createProfile('Web', [
      { key: 'skill:hello', enabled: true },
      { key: 'mcp_server:github', enabled: false },
    ]);

    // The edit flow rebuilds a complete preset over ALL current tools, which now
    // includes a third tool added since creation (recorded, left disabled).
    const rewritten: ProfileToolEntry[] = [
      { key: 'skill:hello', enabled: false }, // toggled off in the edit
      { key: 'mcp_server:github', enabled: true }, // toggled on in the edit
      { key: 'command:greet', enabled: false }, // newly captured
    ];

    const updated = await svc.updateProfile(created.id, { tools: rewritten });

    expect(updated?.tools).toEqual(rewritten);
    expect(svc.getProfile(created.id)?.tools).toEqual(rewritten);
  });
});
