import { ToolType, ConfigScope } from '../../../types/enums.js';
import type { IPlatformAdapter } from '../../../types/adapter.js';
import type { NormalizedTool } from '../../../types/config.js';

/**
 * Shared, fully-typed mock adapter factory for unit tests.
 *
 * Returns a COMPLETE `IPlatformAdapter` -- every interface member is
 * implemented with a sensible no-op/default -- so the returned value
 * genuinely satisfies the interface (no `as any` / `as unknown as` casts).
 *
 * Callers customize behavior by spreading `overrides` on top of the
 * defaults. The `toolsByScope` convenience preserves the previous inline
 * mocks' behavior: the default `readTools(type, scope)` returns
 * `toolsByScope['${type}:${scope}'] ?? []`.
 */
export type MockAdapterOverrides = Partial<IPlatformAdapter> & {
  toolsByScope?: Record<string, NormalizedTool[]>;
};

export function createMockAdapter(overrides: MockAdapterOverrides = {}): IPlatformAdapter {
  const { toolsByScope = {}, ...rest } = overrides;

  const base: IPlatformAdapter = {
    // ILifecycleAdapter
    id: 'mock',
    displayName: 'Mock Platform',
    async detect(): Promise<boolean> {
      return true;
    },
    getWatchPaths(): string[] {
      return [];
    },

    // IToolAdapter
    supportedToolTypes: new Set([
      ToolType.Skill,
      ToolType.McpServer,
      ToolType.Hook,
      ToolType.Command,
    ]),
    async readTools(type: ToolType, scope: ConfigScope): Promise<NormalizedTool[]> {
      return toolsByScope[`${type}:${scope}`] ?? [];
    },
    async writeTool(): Promise<void> {},
    async removeTool(): Promise<void> {},
    async toggleTool(): Promise<void> {},

    // IMcpAdapter
    async installMcpServer(): Promise<void> {},
    getMcpFilePath(): string {
      return '/home/user/.claude.json';
    },
    getMcpSchemaKey(): string {
      return 'claude-json';
    },
    getMcpContainerKey(): string {
      return 'mcpServers';
    },
    getMcpDisableField(): { field: string; disabledValue: unknown } | undefined {
      return { field: 'disabled', disabledValue: true };
    },
    getMcpConfigFormat(): 'toml' | 'json' {
      return 'json';
    },

    // IPathAdapter
    getSkillsDir(): string {
      return '/home/user/.claude/skills';
    },
    getCommandsDir(): string {
      return '/home/user/.claude/commands';
    },
    getSettingsPath(): string {
      return '/home/user/.claude/settings.json';
    },

    // IInstallAdapter
    async installSkill(): Promise<void> {},
    async installCommand(): Promise<void> {},
    async installHook(): Promise<void> {},

    // Capabilities (Phase 4) — off by default; override per test.
    capabilities: {
      mcpEnvVars: false,
      mcpServerToolToggle: false,
      customPromptFileInstall: false,
    },
  };

  return { ...base, ...rest };
}
