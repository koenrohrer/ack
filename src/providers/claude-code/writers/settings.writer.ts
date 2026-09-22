import type { ConfigService } from '../../../services/config.service.js';
import { HookEntrySchema } from '../schemas.js';

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
 * Identifies one matcher group by what it contains, not where it sits.
 *
 * A position alone goes stale: moving one group out of an event's array shifts
 * every later group down, so a second toggle from the same read hits the wrong
 * group. `matcher` and `hooks` are what the parser read; `index` is where the
 * group was then, used only to choose among groups that are identical.
 */
export interface HookGroupLocator {
  index: number;
  matcher: string;
  hooks: ReadonlyArray<Record<string, unknown>>;
}

/** The hook fields HookEntrySchema keeps, read off the schema so the two cannot drift. */
const HOOK_ENTRY_FIELDS = Object.keys(HookEntrySchema.shape);

/**
 * Compare form of a matcher group: the matcher plus, per hook, the fields
 * HookEntrySchema keeps. The parser validates active hooks through that
 * schema, which drops every other key, so a locator built from parsed
 * metadata must still match the raw group it came from.
 */
function hookGroupSignature(group: { matcher?: unknown; hooks?: unknown }): string {
  const hooks: unknown[] = Array.isArray(group.hooks) ? group.hooks : [];
  return JSON.stringify([
    typeof group.matcher === 'string' ? group.matcher : '',
    hooks.map((hook) => {
      const entry = (hook ?? {}) as Record<string, unknown>;
      return HOOK_ENTRY_FIELDS.map((field) => entry[field]);
    }),
  ]);
}

/**
 * Index of the group `locator` describes within `groups`, or -1.
 *
 * Prefers `locator.index` when the group there matches, so of several
 * identical groups the one that was read is the one changed; otherwise takes
 * the first match.
 */
export function findHookGroupIndex(
  groups: ReadonlyArray<{ matcher?: unknown; hooks?: unknown }>,
  locator: HookGroupLocator,
): number {
  const wanted = hookGroupSignature(locator);
  const hinted = groups[locator.index];
  if (hinted !== undefined && hookGroupSignature(hinted) === wanted) {
    return locator.index;
  }
  return groups.findIndex((group) => hookGroupSignature(group) === wanted);
}

/**
 * Resolve a writer's target to an index. A bare number is used as given; a
 * locator that matches nothing throws, so the write is abandoned rather than
 * applied to whichever group now sits at the old position.
 */
function resolveHookTarget(
  groups: HookMatcherGroup[],
  target: number | HookGroupLocator,
  filePath: string,
  eventName: string,
): number {
  if (typeof target === 'number') {
    return target;
  }
  const index = findHookGroupIndex(groups, target);
  if (index === -1) {
    const label = target.matcher ? `${eventName} (${target.matcher})` : eventName;
    throw new Error(
      `Hook ${label} was not found in ${filePath}; the file changed since it was read. Refresh and try again.`,
    );
  }
  return index;
}

/**
 * Toggle a hook by moving it between `hooks` and `_disabledHooks`.
 *
 * - disable=true:  splice the target from `hooks[eventName]`, append to `_disabledHooks[eventName]`
 * - disable=false: splice the target from `_disabledHooks[eventName]`, append to `hooks[eventName]`
 *
 * `target` is a HookGroupLocator, or a bare index into the source array.
 * This ensures Claude Code never sees the disabled hook at all.
 */
export async function toggleHook(
  configService: ConfigService,
  filePath: string,
  eventName: string,
  target: number | HookGroupLocator,
  disable: boolean,
): Promise<void> {
  await configService.writeConfigFile(filePath, 'settings-file', (current: Record<string, unknown>) => {
    const hooks = { ...((current.hooks as HooksRecord) ?? {}) };
    const stash = { ...((current._disabledHooks as HooksRecord) ?? {}) };

    const sourceField = disable ? hooks : stash;
    const destField = disable ? stash : hooks;

    const sourceMatchers = [...(sourceField[eventName] ?? [])];
    const matcherIndex = resolveHookTarget(sourceMatchers, target, filePath, eventName);

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
 * Splices the target group from the event's array; `target` is a
 * HookGroupLocator, or a bare index. If the array becomes empty after
 * removal, removes the event key entirely.
 *
 * @param stashed - If true, removes from `_disabledHooks` instead of `hooks`.
 */
export async function removeHook(
  configService: ConfigService,
  filePath: string,
  eventName: string,
  target: number | HookGroupLocator,
  stashed = false,
): Promise<void> {
  await configService.writeConfigFile(filePath, 'settings-file', (current: Record<string, unknown>) => {
    const fieldName = stashed ? '_disabledHooks' : 'hooks';
    const source = { ...((current[fieldName] as HooksRecord) ?? {}) };
    const matchers = [...(source[eventName] ?? [])];
    const matcherIndex = resolveHookTarget(matchers, target, filePath, eventName);

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
 *
 * @param stashed - If true, adds to `_disabledHooks` so the group stays disabled.
 */
export async function addHook(
  configService: ConfigService,
  filePath: string,
  eventName: string,
  matcherGroup: HookMatcherGroup,
  stashed = false,
): Promise<void> {
  await configService.writeConfigFile(filePath, 'settings-file', (current: Record<string, unknown>) => {
    const fieldName = stashed ? '_disabledHooks' : 'hooks';
    const hooks = { ...((current[fieldName] as HooksRecord) ?? {}) };
    const matchers = [...(hooks[eventName] ?? [])];

    matchers.push(matcherGroup);
    hooks[eventName] = matchers;

    return { ...current, [fieldName]: hooks };
  });
}
