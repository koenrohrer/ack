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

});
