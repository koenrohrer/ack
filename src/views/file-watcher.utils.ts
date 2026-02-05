/**
 * Pure utility functions for file watcher directory collection.
 *
 * Extracted from file-watcher.manager.ts to enable unit testing
 * without requiring the VS Code API module.
 */

import * as path from 'path';
import type { IPlatformAdapter } from '../types/adapter.js';
import { ConfigScope } from '../types/enums.js';

/**
 * Collects and deduplicates watch directories from a platform adapter.
 *
 * Gathers all paths from getWatchPaths() across all scopes, resolves each
 * to its parent directory (for files) or keeps it as-is (for directories),
 * then deduplicates. Directories that contain skills/commands are flagged
 * for recursive watching.
 */
export function collectWatchDirs(adapter: IPlatformAdapter): {
  dir: string;
  recursive: boolean;
}[] {
  const allScopes = [
    ConfigScope.User,
    ConfigScope.Project,
    ConfigScope.Local,
    ConfigScope.Managed,
  ];

  const dirSet = new Map<string, boolean>();

  for (const scope of allScopes) {
    const paths = adapter.getWatchPaths(scope);

    for (const p of paths) {
      // Skills, commands, and prompts directories need recursive watching
      // because they contain subdirectories (skills/commands) or multiple files (prompts).
      const basename = path.basename(p);
      const isRecursiveDir = basename === 'skills' || basename === 'commands' || basename === 'prompts';

      if (isRecursiveDir) {
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
