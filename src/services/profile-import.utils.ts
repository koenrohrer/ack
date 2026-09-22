import type { NormalizedTool } from '../types/config.js';
import type { ExportedTool } from './profile.types.js';

/** The hook fields an import compares; a difference in any of them is reported. */
const HOOK_FIELDS = ['type', 'command', 'prompt', 'timeout'] as const;

/** True when two arrays hold the same strings in the same order. */
function sameArgs(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** True when two env maps have the same keys. Values differ per machine and are ignored. */
function sameEnvKeys(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  return sameArgs(keysA, keysB);
}

/** True when two hook lists hold, in order, hooks with the same HOOK_FIELDS. */
function sameHooks(a: ReadonlyArray<Record<string, unknown>>, b: ReadonlyArray<Record<string, unknown>>): boolean {
  return a.length === b.length && a.every((hook, i) => HOOK_FIELDS.every((field) => hook[field] === b[i][field]));
}

/**
 * Name the config fields whose imported value differs from the local tool's.
 *
 * Returns field names only (for an MCP server: command, url, args, env; for a
 * hook group: eventName, matcher, hooks), never a value. Args compare element
 * by element, env compares its key set, and hooks compare type, command,
 * prompt and timeout of each hook. Other kinds yield [].
 */
export function importConflictFields(exported: ExportedTool, local: NormalizedTool): string[] {
  const config = exported.config;
  const meta = local.metadata;
  const fields: string[] = [];
  switch (config.kind) {
    case 'mcp_server':
      if (config.command !== ((meta.command as string | undefined) ?? '')) {
        fields.push('command');
      }
      if ((config.url ?? '') !== ((meta.url as string | undefined) ?? '')) {
        fields.push('url');
      }
      if (!sameArgs(config.args, (meta.args as unknown[] | undefined) ?? [])) {
        fields.push('args');
      }
      if (!sameEnvKeys(config.env, (meta.env as Record<string, unknown> | undefined) ?? {})) {
        fields.push('env');
      }
      break;
    case 'hook':
      if (config.eventName !== ((meta.eventName as string | undefined) ?? '')) {
        fields.push('eventName');
      }
      if (config.matcher !== ((meta.matcher as string | undefined) ?? '')) {
        fields.push('matcher');
      }
      if (!sameHooks(config.hooks, (meta.hooks as Array<Record<string, unknown>> | undefined) ?? [])) {
        fields.push('hooks');
      }
      break;
    default:
      break;
  }
  return fields;
}
