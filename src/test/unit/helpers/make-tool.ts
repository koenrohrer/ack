import { ToolType, ConfigScope, ToolStatus } from '../../../types/enums.js';
import type { NormalizedTool } from '../../../types/config.js';

/**
 * Shared, fully-typed factory for building `NormalizedTool` fixtures in tests.
 *
 * Returns a COMPLETE `NormalizedTool` -- every required field is populated --
 * so the returned value genuinely satisfies the type (no `as any` /
 * `as unknown as` casts at call sites).
 *
 * `name` and `scope` are required; everything else falls back to sensible
 * defaults. The `id` is always derived as `${type}:${name}:${scope}`.
 */
export function makeTool(
  overrides: Partial<NormalizedTool> & { name: string; scope: ConfigScope },
): NormalizedTool {
  const type = overrides.type ?? ToolType.McpServer;
  return {
    id: `${type}:${overrides.name}:${overrides.scope}`,
    type,
    name: overrides.name,
    description: overrides.description,
    scope: overrides.scope,
    status: overrides.status ?? ToolStatus.Enabled,
    statusDetail: overrides.statusDetail,
    source: overrides.source ?? { filePath: `/fake/${overrides.scope}/${overrides.name}` },
    metadata: overrides.metadata ?? {},
    scopeEntries: overrides.scopeEntries,
  };
}
