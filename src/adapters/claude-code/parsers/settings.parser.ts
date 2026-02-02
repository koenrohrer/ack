import type { FileIOService } from '../../../services/fileio.service.js';
import type { SchemaService } from '../../../services/schema.service.js';
import { ToolType, ConfigScope, ToolStatus } from '../../../types/enums.js';
import type { NormalizedTool } from '../../../types/config.js';

interface HookMatcherEntry {
  matcher: string;
  hooks: Array<{ type: string; command?: string; prompt?: string; timeout?: number }>;
}

/**
 * Parse a Claude Code settings JSON file and extract hook definitions
 * as NormalizedTool entries.
 *
 * Returns an empty array if the file does not exist (not an error --
 * config files are optional). Returns a single Error-status tool if
 * the file exists but fails validation.
 *
 * Also reads `_disabledHooks` (extension-managed stash for per-hook
 * disable) and returns those entries with Disabled status.
 */
export async function parseSettingsFile(
  fileIO: FileIOService,
  schemaService: SchemaService,
  filePath: string,
  scope: ConfigScope,
): Promise<NormalizedTool[]> {
  const readResult = await fileIO.readJsonFile(filePath);

  if (!readResult.success) {
    return [makeErrorTool(filePath, scope, readResult.error)];
  }

  // Missing file -- nothing to parse
  if (readResult.data === null) {
    return [];
  }

  const validation = schemaService.validate('settings-file', readResult.data);
  if (!validation.success) {
    const message = validation.error.issues
      .map((i) => i.message)
      .join('; ');
    return [makeErrorTool(filePath, scope, message)];
  }

  const data = validation.data as {
    hooks?: Record<string, HookMatcherEntry[]>;
    _disabledHooks?: Record<string, HookMatcherEntry[]>;
    disabledMcpServers?: string[];
  };

  const tools: NormalizedTool[] = [];

  // Parse active hooks
  if (data.hooks) {
    for (const [eventName, matchers] of Object.entries(data.hooks)) {
      for (let i = 0; i < matchers.length; i++) {
        tools.push(makeHookTool(matchers[i], eventName, i, scope, filePath, ToolStatus.Enabled, false));
      }
    }
  }

  // Parse stashed (disabled) hooks
  if (data._disabledHooks) {
    for (const [eventName, matchers] of Object.entries(data._disabledHooks)) {
      for (let i = 0; i < matchers.length; i++) {
        tools.push(makeHookTool(matchers[i], eventName, i, scope, filePath, ToolStatus.Disabled, true));
      }
    }
  }

  return tools;
}

/**
 * Read the disabledMcpServers array from a settings file.
 * Returns an empty array if file is missing or invalid.
 */
export async function readDisabledMcpServers(
  fileIO: FileIOService,
  schemaService: SchemaService,
  filePath: string,
): Promise<string[]> {
  const readResult = await fileIO.readJsonFile(filePath);

  if (!readResult.success || readResult.data === null) {
    return [];
  }

  const validation = schemaService.validate('settings-file', readResult.data);
  if (!validation.success) {
    return [];
  }

  const data = validation.data as { disabledMcpServers?: string[] };
  return data.disabledMcpServers ?? [];
}

function makeHookTool(
  entry: HookMatcherEntry,
  eventName: string,
  index: number,
  scope: ConfigScope,
  filePath: string,
  status: ToolStatus,
  stashed: boolean,
): NormalizedTool {
  const matcherLabel = entry.matcher ? ` (${entry.matcher})` : '';
  const idPrefix = stashed ? 'hook-stashed' : 'hook';

  return {
    id: `${idPrefix}:${scope}:${eventName}:${index}`,
    type: ToolType.Hook,
    name: `${eventName}${matcherLabel}`,
    scope,
    status,
    source: { filePath },
    metadata: {
      eventName,
      matcher: entry.matcher,
      hooks: entry.hooks,
      type: entry.hooks[0]?.type,
      stashed,
    },
  };
}

function makeErrorTool(filePath: string, scope: ConfigScope, detail: string): NormalizedTool {
  return {
    id: `settings-error:${scope}:${filePath}`,
    type: ToolType.Hook,
    name: 'Settings Error',
    scope,
    status: ToolStatus.Error,
    statusDetail: detail,
    source: { filePath },
    metadata: {},
  };
}
