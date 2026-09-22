import { describe, it, expect, vi } from 'vitest';
import { ProfileService } from '../../services/profile.service.js';
import { ProviderRegistry } from '../../providers/provider.registry.js';
import { createMockProvider } from './helpers/mock-provider.js';
import { ToolType, ConfigScope, ToolStatus } from '../../types/enums.js';
import { PROFILE_STORE_KEY } from '../../services/profile.types.js';
import type { NormalizedTool } from '../../types/config.js';

type CtorArgs = ConstructorParameters<typeof ProfileService>;

/** In-memory vscode.Memento stand-in, seeded with one profile. */
function mementoWith(tools: Array<{ key: string; enabled: boolean }>): CtorArgs[0] {
  const store = new Map<string, unknown>([
    [
      PROFILE_STORE_KEY,
      {
        version: 2,
        profiles: [
          { id: 'p1', name: 'Quiet', agentId: 'mock', tools, createdAt: 'x', updatedAt: 'x' },
        ],
        activeProfileId: null,
      },
    ],
  ]);
  return {
    get: (key: string, def?: unknown) => (store.has(key) ? store.get(key) : def),
    update: (key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    },
    keys: () => [...store.keys()],
  } as unknown as CtorArgs[0];
}

/** A hook matcher group as the Claude Code settings parser reports it. */
function hook(
  index: number,
  command: string,
  status: ToolStatus,
  scope: ConfigScope = ConfigScope.Project,
): NormalizedTool {
  return {
    id: `hook:${scope}:PreToolUse:${index}`,
    type: ToolType.Hook,
    name: 'PreToolUse (Bash)',
    scope,
    status,
    source: { filePath: `/ws/${scope}/settings.json` },
    metadata: { eventName: 'PreToolUse', matcher: 'Bash', hooks: [{ type: 'command', command }] },
  };
}

function makeService(
  winners: NormalizedTool[],
  byScope: Partial<Record<ConfigScope, NormalizedTool[]>>,
  tools: Array<{ key: string; enabled: boolean }>,
) {
  const registry = new ProviderRegistry();
  registry.register(createMockProvider()); // id 'mock', supports Hook
  registry.setActiveProvider('mock');
  const configService = {
    readAllTools: async (type: ToolType) => (type === ToolType.Hook ? winners : []),
    readToolsByScope: async (type: ToolType, scope: ConfigScope) =>
      type === ToolType.Hook ? (byScope[scope] ?? []) : [],
  } as unknown as CtorArgs[1];
  const toggleTool = vi.fn(async () => ({ success: true as const }));
  const svc = new ProfileService(
    mementoWith(tools),
    configService,
    { toggleTool } as unknown as CtorArgs[2],
    registry,
    {} as unknown as CtorArgs[4],
  );
  return { svc, toggleTool };
}

describe('ProfileService.switchProfile — hook groups sharing one key', () => {
  it('applies the entry to every group with that event and matcher in the scope', async () => {
    const first = hook(0, 'echo a', ToolStatus.Enabled);
    const second = hook(1, 'echo b', ToolStatus.Enabled);
    // readAllTools collapses both groups to one canonical key and keeps the first.
    const { svc, toggleTool } = makeService([first], { [ConfigScope.Project]: [first, second] }, [
      { key: 'hook:PreToolUse:Bash', enabled: false },
    ]);

    const result = await svc.switchProfile('p1');

    expect(toggleTool.mock.calls.map(([tool]) => (tool as NormalizedTool).id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(result.toggled).toBe(2);
  });

  it('skips a group that is already in the desired state', async () => {
    const first = hook(0, 'echo a', ToolStatus.Enabled);
    const second = hook(0, 'echo b', ToolStatus.Disabled);
    const { svc, toggleTool } = makeService([first], { [ConfigScope.Project]: [first, second] }, [
      { key: 'hook:PreToolUse:Bash', enabled: false },
    ]);

    await svc.switchProfile('p1');

    expect(toggleTool.mock.calls.map(([tool]) => (tool as NormalizedTool).id)).toEqual([first.id]);
  });

  it('leaves a same-key group in a lower-precedence scope alone', async () => {
    const project = hook(0, 'echo a', ToolStatus.Enabled, ConfigScope.Project);
    const user = hook(0, 'echo z', ToolStatus.Enabled, ConfigScope.User);
    const { svc, toggleTool } = makeService(
      [project],
      { [ConfigScope.Project]: [project], [ConfigScope.User]: [user] },
      [{ key: 'hook:PreToolUse:Bash', enabled: false }],
    );

    await svc.switchProfile('p1');

    expect(toggleTool.mock.calls.map(([tool]) => (tool as NormalizedTool).id)).toEqual([project.id]);
  });

  it('does not unstash a same-key sibling when the entry enables', async () => {
    const winner = hook(0, 'echo a', ToolStatus.Enabled);
    const stashed = hook(1, 'echo b', ToolStatus.Disabled);
    const { svc, toggleTool } = makeService([winner], { [ConfigScope.Project]: [winner, stashed] }, [
      { key: 'hook:PreToolUse:Bash', enabled: true },
    ]);

    const result = await svc.switchProfile('p1');

    expect(toggleTool).not.toHaveBeenCalled();
    expect(result.toggled).toBe(0);
  });

  it('does not enable a stashed winner when a same-key sibling is active', async () => {
    const winner = hook(0, 'echo a', ToolStatus.Disabled);
    const active = hook(1, 'echo b', ToolStatus.Enabled);
    const { svc, toggleTool } = makeService([winner], { [ConfigScope.Project]: [winner, active] }, [
      { key: 'hook:PreToolUse:Bash', enabled: true },
    ]);

    const result = await svc.switchProfile('p1');

    expect(toggleTool).not.toHaveBeenCalled();
    expect(result.toggled).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('enables the only stashed group when no same-key group is active', async () => {
    const only = hook(0, 'echo a', ToolStatus.Disabled);
    const { svc, toggleTool } = makeService([only], { [ConfigScope.Project]: [only] }, [
      { key: 'hook:PreToolUse:Bash', enabled: true },
    ]);

    const result = await svc.switchProfile('p1');

    expect(toggleTool.mock.calls.map(([tool]) => (tool as NormalizedTool).id)).toEqual([only.id]);
    expect(result.toggled).toBe(1);
    expect(result.errors).toEqual([]);
  });
});

describe('ProfileService.switchProfile — ambiguous hook enable', () => {
  it('enables no group and warns when a disable then an enable leaves several groups stashed', async () => {
    // A settings file with an active lint.sh group and a stashed risky.sh group
    // under one key. toggleTool flips the stored status, as the real one does.
    let groups = [hook(0, 'lint.sh', ToolStatus.Enabled), hook(1, 'risky.sh', ToolStatus.Disabled)];
    const registry = new ProviderRegistry();
    registry.register(createMockProvider());
    registry.setActiveProvider('mock');
    const configService = {
      readAllTools: async (type: ToolType) => (type === ToolType.Hook ? [{ ...groups[0] }] : []),
      readToolsByScope: async (type: ToolType, scope: ConfigScope) =>
        type === ToolType.Hook && scope === ConfigScope.Project ? groups.map((g) => ({ ...g })) : [],
    } as unknown as CtorArgs[1];
    const toggleTool = vi.fn(async (tool: NormalizedTool) => {
      groups = groups.map((g) =>
        g.id === tool.id
          ? { ...g, status: g.status === ToolStatus.Enabled ? ToolStatus.Disabled : ToolStatus.Enabled }
          : g,
      );
      return { success: true as const };
    });
    const memento = mementoWith([{ key: 'hook:PreToolUse:Bash', enabled: false }]);
    const svc = new ProfileService(
      memento,
      configService,
      { toggleTool } as unknown as CtorArgs[2],
      registry,
      {} as unknown as CtorArgs[4],
    );
    const p2 = await svc.createProfile('Loud');
    await svc.updateProfile(p2.id, { tools: [{ key: 'hook:PreToolUse:Bash', enabled: true }] });

    await svc.switchProfile('p1');
    expect(groups.map((g) => g.status)).toEqual([ToolStatus.Disabled, ToolStatus.Disabled]);
    toggleTool.mockClear();

    const result = await svc.switchProfile(p2.id);

    expect(toggleTool).not.toHaveBeenCalled();
    expect(groups.map((g) => g.status)).toEqual([ToolStatus.Disabled, ToolStatus.Disabled]);
    expect(result.toggled).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('hook:PreToolUse:Bash');
    expect(result.errors[0]).toContain('2');
  });
});
