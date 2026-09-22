import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Path containment for plugin package contents, Agent Plugins 1.0.0 §4.1.
 *
 * "When a client discovers, reads, or executes a file or directory supplied by
 *  the plugin package, the filesystem-resolved path MUST remain within the
 *  filesystem-resolved plugin root."
 */

/**
 * Resolve `absolute` as far as the filesystem allows.
 *
 * The target need not exist: §7.2.2.5 makes a server that fails to start a
 * connection failure and explicitly not invalid configuration, so a
 * `command: "./bin/server"` naming a not-yet-built artifact is valid config
 * that a bare `realpath` would wrongly reject with ENOENT. Instead, realpath
 * the nearest existing ancestor and re-join the segments below it -- which also
 * keeps an escaping symlink directory from hiding behind a missing child.
 *
 * Returns null when a component exists but cannot be resolved (a dangling or
 * looping symlink); such a path is never safe to treat as contained.
 */
async function resolveThroughSymlinks(absolute: string): Promise<string | null> {
  const pending: string[] = [];
  let current = absolute;

  for (;;) {
    try {
      const real = await fs.realpath(current);
      return pending.length > 0 ? path.join(real, ...pending) : real;
    } catch {
      if (await entryExists(current)) {
        return null;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return null;
      }
      pending.unshift(path.basename(current));
      current = parent;
    }
  }
}

/** Whether a filesystem entry exists at `target`, without following a link. */
async function entryExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether `candidate` is `root` or lies beneath it.
 *
 * Compares path segments rather than string prefixes: `${root}-sibling` shares
 * the root's prefix as a string but is not inside it.
 */
function isWithin(root: string, candidate: string): boolean {
  if (candidate === root) {
    return true;
  }
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/**
 * Whether `candidate` resolves within `root` after symlink resolution.
 *
 * Both paths are resolved first, so a root reached through a symlink and a
 * candidate given by its real path still compare correctly. Never throws.
 */
export async function isContained(root: string, candidate: string): Promise<boolean> {
  try {
    const resolvedRoot = await resolveThroughSymlinks(path.resolve(root));
    const resolvedCandidate = await resolveThroughSymlinks(path.resolve(candidate));
    if (resolvedRoot === null || resolvedCandidate === null) {
      return false;
    }
    return isWithin(resolvedRoot, resolvedCandidate);
  } catch {
    return false;
  }
}

/**
 * Resolve a plugin-relative path field against the plugin root.
 *
 * Per §4.1 the value MUST begin with `./` and MUST remain within the
 * filesystem-resolved root: `data` and `../bin/server` are both invalid, and so
 * is a `./` path whose components symlink out of the package.
 *
 * Returns the absolute path, or null when the value is rejected. Never throws.
 */
export async function resolvePluginRelative(root: string, value: string): Promise<string | null> {
  if (!value.startsWith('./')) {
    return null;
  }
  const resolved = path.resolve(root, value);
  if (!(await isContained(root, resolved))) {
    return null;
  }
  return resolved;
}
