import type { ConfigService } from '../../../services/config.service.js';

/**
 * Writer functions for hook mutations in settings JSON files.
 *
 * All JSON mutations go through ConfigService.writeConfigFile() which
 * implements the safe re-read -> mutate -> validate -> backup -> write pipeline.
 *
 * Claude Code does not support per-hook disable natively. To disable a hook,
 * we move its matcher group from `hooks` to `_disabledHooks` (a custom
 * extension-managed field preserved by .passthrough() on the schema).
 * Claude Code ignores `_disabledHooks`, so the hook truly stops executing.
 */

interface HookMatcherGroup {
  matcher: string;
  hooks: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

type HooksRecord = Record<string, HookMatcherGroup[]>;

/**
 * Toggle a hook by moving it between `hooks` and `_disabledHooks`.
 *
 * - disable=true:  splice from `hooks[eventName][matcherIndex]`, append to `_disabledHooks[eventName]`
 * - disable=false: splice from `_disabledHooks[eventName][matcherIndex]`, append to `hooks[eventName]`
 *
 * This ensures Claude Code never sees the disabled hook at all.
 */
export async function toggleHook(
  configService: ConfigService,
  filePath: string,
  eventName: string,
  matcherIndex: number,
  disable: boolean,
): Promise<void> {
  await configService.writeConfigFile(filePath, 'settings-file', (current: Record<string, unknown>) => {
    const hooks = { ...((current.hooks as HooksRecord) ?? {}) };
    const stash = { ...((current._disabledHooks as HooksRecord) ?? {}) };

    const sourceField = disable ? hooks : stash;
    const destField = disable ? stash : hooks;

    const sourceMatchers = [...(sourceField[eventName] ?? [])];

    if (matcherIndex >= 0 && matcherIndex < sourceMatchers.length) {
      const [removed] = sourceMatchers.splice(matcherIndex, 1);
      // Clean up stale disabled field from old approach if present
      const { disabled: _, ...clean } = removed;

      if (sourceMatchers.length === 0) {
        delete sourceField[eventName];
      } else {
        sourceField[eventName] = sourceMatchers;
      }

      const destMatchers = [...(destField[eventName] ?? [])];
      destMatchers.push(clean as HookMatcherGroup);
      destField[eventName] = destMatchers;
    }

    const result: Record<string, unknown> = { ...current, hooks };
    if (Object.keys(stash).length > 0) {
      result._disabledHooks = stash;
    } else {
      delete result._disabledHooks;
    }
    return result;
  });
}

/**
 * Remove a hook matcher group from the settings file.
 *
 * Splices the matcher at the given index from the event's array.
 * If the array becomes empty after removal, removes the event key entirely.
 *
 * @param stashed - If true, removes from `_disabledHooks` instead of `hooks`.
 */
export async function removeHook(
  configService: ConfigService,
  filePath: string,
  eventName: string,
  matcherIndex: number,
  stashed = false,
): Promise<void> {
  await configService.writeConfigFile(filePath, 'settings-file', (current: Record<string, unknown>) => {
    const fieldName = stashed ? '_disabledHooks' : 'hooks';
    const source = { ...((current[fieldName] as HooksRecord) ?? {}) };
    const matchers = [...(source[eventName] ?? [])];

    if (matcherIndex >= 0 && matcherIndex < matchers.length) {
      matchers.splice(matcherIndex, 1);

      if (matchers.length === 0) {
        delete source[eventName];
      } else {
        source[eventName] = matchers;
      }
    }

    const result = { ...current };
    if (Object.keys(source).length > 0) {
      result[fieldName] = source;
    } else {
      delete result[fieldName];
    }
    return result;
  });
}

/**
 * Add a hook matcher group to the settings file.
 *
 * Pushes the matcher group into the event's array, creating the
 * event array if it does not exist. Used for scope move.
 */
export async function addHook(
  configService: ConfigService,
  filePath: string,
  eventName: string,
  matcherGroup: HookMatcherGroup,
): Promise<void> {
  await configService.writeConfigFile(filePath, 'settings-file', (current: Record<string, unknown>) => {
    const hooks = { ...((current.hooks as HooksRecord) ?? {}) };
    const matchers = [...(hooks[eventName] ?? [])];

    matchers.push(matcherGroup);
    hooks[eventName] = matchers;

    return { ...current, hooks };
  });
}
