import type { ConfigService } from '../../../services/config.service.js';

/**
 * Writer functions for hook mutations in settings JSON files.
 *
 * All JSON mutations go through ConfigService.writeConfigFile() which
 * implements the safe re-read -> mutate -> validate -> backup -> write pipeline.
 *
 * The `disabled` field on matcher groups is a custom UI-only marker.
 * Claude Code does not natively support per-hook disable, but
 * .passthrough() on HookMatcherSchema preserves it through validation.
 */

interface HookMatcherGroup {
  matcher: string;
  hooks: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

/**
 * Toggle the disabled state of a hook matcher group.
 *
 * Sets a custom `disabled` field on the matcher group at the given
 * index within the specified event's matchers array.
 */
export async function toggleHook(
  configService: ConfigService,
  filePath: string,
  eventName: string,
  matcherIndex: number,
  disabled: boolean,
): Promise<void> {
  await configService.writeConfigFile(filePath, 'settings-file', (current: Record<string, unknown>) => {
    const hooks = { ...((current.hooks as Record<string, HookMatcherGroup[]>) ?? {}) };
    const matchers = [...(hooks[eventName] ?? [])];

    if (matcherIndex >= 0 && matcherIndex < matchers.length) {
      matchers[matcherIndex] = { ...matchers[matcherIndex], disabled };
      hooks[eventName] = matchers;
    }

    return { ...current, hooks };
  });
}

/**
 * Remove a hook matcher group from the settings file.
 *
 * Splices the matcher at the given index from the event's array.
 * If the array becomes empty after removal, removes the event key entirely.
 */
export async function removeHook(
  configService: ConfigService,
  filePath: string,
  eventName: string,
  matcherIndex: number,
): Promise<void> {
  await configService.writeConfigFile(filePath, 'settings-file', (current: Record<string, unknown>) => {
    const hooks = { ...((current.hooks as Record<string, HookMatcherGroup[]>) ?? {}) };
    const matchers = [...(hooks[eventName] ?? [])];

    if (matcherIndex >= 0 && matcherIndex < matchers.length) {
      matchers.splice(matcherIndex, 1);

      if (matchers.length === 0) {
        delete hooks[eventName];
      } else {
        hooks[eventName] = matchers;
      }
    }

    return { ...current, hooks };
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
    const hooks = { ...((current.hooks as Record<string, HookMatcherGroup[]>) ?? {}) };
    const matchers = [...(hooks[eventName] ?? [])];

    matchers.push(matcherGroup);
    hooks[eventName] = matchers;

    return { ...current, hooks };
  });
}
