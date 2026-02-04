/**
 * Temporary re-exports with deprecation warnings.
 *
 * These re-exports exist during the adapter purification transition to ensure
 * any missed import path still works. Each access logs a console.warn so
 * remaining consumers are visible during development.
 *
 * LIFECYCLE: Created in Phase 12 Plan 01. Will be cleaned up by end of Phase 12.
 */

import { ClaudeCodePaths as _ClaudeCodePaths } from './paths.js';

let _pathsWarningLogged = false;

/**
 * @deprecated Use IPlatformAdapter path methods instead of ClaudeCodePaths.
 *
 * Use adapter.getSkillsDir(), adapter.getCommandsDir(),
 * adapter.getSettingsPath(), adapter.getMcpFilePath() instead.
 */
export const ClaudeCodePaths = new Proxy(_ClaudeCodePaths, {
  get(target, prop, receiver) {
    if (!_pathsWarningLogged) {
      console.warn(
        '[ACK] Direct import of ClaudeCodePaths is deprecated. ' +
        'Use the IPlatformAdapter interface methods instead. ' +
        'This re-export will be removed at the end of Phase 12.',
      );
      _pathsWarningLogged = true;
    }
    return Reflect.get(target, prop, receiver);
  },
});
