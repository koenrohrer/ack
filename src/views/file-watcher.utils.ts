/**
 * Pure utility functions for file watcher directory collection.
 *
 * Extracted from file-watcher.manager.ts to enable unit testing
 * without requiring the VS Code API module.
 */

import * as path from 'path';
import type { AgentProvider } from '../types/provider.js';
import { ConfigScope } from '../types/enums.js';

const ALL_SCOPES: readonly ConfigScope[] = [
  ConfigScope.User,
  ConfigScope.Project,
  ConfigScope.Local,
  ConfigScope.Managed,
];

/**
 * Whether a watch path is a directory that needs recursive watching.
 *
 * Skills, commands, prompts, instructions, and agents directories contain
 * subdirectories (skills/commands) or multiple files (prompts/agents). Every
 * other watch path is a config file, watched through its parent directory.
 */
function isRecursiveWatchPath(p: string): boolean {
  const basename = path.basename(p);
  return basename === 'skills' || basename === 'commands'
    || basename === 'prompts' || basename === 'instructions' || basename === 'agents';
}

/**
 * Collects and deduplicates watch directories from a platform provider.
 *
 * Gathers all paths from getWatchPaths() across all scopes, resolves each
 * to its parent directory (for files) or keeps it as-is (for directories),
 * then deduplicates. Directories that contain skills/commands are flagged
 * for recursive watching.
 */
export function collectWatchDirs(provider: AgentProvider): {
  dir: string;
  recursive: boolean;
}[] {
  const dirSet = new Map<string, boolean>();

  for (const scope of ALL_SCOPES) {
    const paths = provider.getWatchPaths(scope);

    for (const p of paths) {
      if (isRecursiveWatchPath(p)) {
        // Watch the directory itself recursively
        if (!dirSet.has(p)) {
          dirSet.set(p, true);
        }
      } else {
        // For config files, watch the parent directory (non-recursive)
        const dir = path.dirname(p);
        if (!dirSet.has(dir)) {
          dirSet.set(dir, false);
        }
      }
    }
  }

  return Array.from(dirSet.entries()).map(([dir, recursive]) => ({
    dir,
    recursive,
  }));
}

/**
 * Maps each non-recursive watch directory to the file names watched in it.
 *
 * A config file is watched through its parent directory with a `*` pattern,
 * so the watcher also reports every sibling. For `~/.claude.json` that parent
 * is the home directory, and a write to `~/.bash_history` would otherwise
 * refresh the tree and show a notification. A directory that is also a
 * recursive watch path gets no entry: everything under it is relevant.
 */
export function collectWatchedFileNames(provider: AgentProvider): Map<string, Set<string>> {
  const recursiveDirs = new Set<string>();
  const namesByDir = new Map<string, Set<string>>();

  for (const scope of ALL_SCOPES) {
    for (const p of provider.getWatchPaths(scope)) {
      if (isRecursiveWatchPath(p)) {
        recursiveDirs.add(p);
        continue;
      }
      const dir = path.dirname(p);
      const names = namesByDir.get(dir) ?? new Set<string>();
      names.add(path.basename(p));
      namesByDir.set(dir, names);
    }
  }

  for (const dir of recursiveDirs) {
    namesByDir.delete(dir);
  }
  return namesByDir;
}

/**
 * Whether a change at `changedPath` concerns a watched file.
 *
 * `watchedNames` is the entry {@link collectWatchedFileNames} holds for the
 * watcher's directory; `undefined` means the directory has no filter and
 * every change counts.
 */
export function isWatchedChange(
  watchedNames: ReadonlySet<string> | undefined,
  changedPath: string,
): boolean {
  if (watchedNames === undefined) {
    return true;
  }
  return watchedNames.has(path.basename(changedPath));
}
