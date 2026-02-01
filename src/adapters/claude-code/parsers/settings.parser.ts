import type { FileIOService } from '../../../services/fileio.service.js';
import type { SchemaService } from '../../../services/schema.service.js';
import { ToolType, ConfigScope, ToolStatus } from '../../../types/enums.js';
import type { NormalizedTool } from '../../../types/config.js';

/**
 * Parse a Claude Code settings JSON file and extract hook definitions
 * as NormalizedTool entries.
 *
 * Returns an empty array if the file does not exist (not an error --
 * config files are optional). Returns a single Error-status tool if
 * the file exists but fails validation.
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
    hooks?: Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command?: string; prompt?: string; timeout?: number }> }>>;
    disabledMcpServers?: string[];
  };

  if (!data.hooks) {
    return [];
  }

  const tools: NormalizedTool[] = [];

  for (const [eventName, matchers] of Object.entries(data.hooks)) {
    for (let i = 0; i < matchers.length; i++) {
      const matcherEntry = matchers[i];
      const matcherLabel = matcherEntry.matcher
        ? ` (${matcherEntry.matcher})`
        : '';

      tools.push({
        id: `hook:${scope}:${eventName}:${i}`,
        type: ToolType.Hook,
        name: `${eventName}${matcherLabel}`,
        scope,
        status: ToolStatus.Enabled,
        source: { filePath },
        metadata: {
          eventName,
          matcher: matcherEntry.matcher,
          hooks: matcherEntry.hooks,
          type: matcherEntry.hooks[0]?.type,
        },
      });
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
