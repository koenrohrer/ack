import type { ConfigScope } from './enums.js';

/**
 * Outcome of installing a custom prompt / instruction from a local file.
 *
 * - `installed`: written; `name` is the installed identity for messaging.
 * - `conflict`: a file already exists at the target and `overwrite` was not set;
 *   the caller confirms and re-invokes with `{ overwrite: true }`.
 * - `rejected`: cannot install (wrong extension, no workspace, unreadable);
 *   `reason` is a user-facing message.
 */
export type CustomPromptInstallResult =
  | { status: 'installed'; name: string }
  | { status: 'conflict'; name: string }
  | { status: 'rejected'; reason: string };

/**
 * Tool installation capability interface.
 *
 * Handles writing tool content (skills, commands, hooks) to the
 * correct scope-specific location. The provider manages directory
 * creation and file writing internally.
 */
export interface InstallCapability {
  /**
   * Install a skill by writing files to the scope's skills directory.
   *
   * Creates the target directory at getSkillsDir(scope)/skillName
   * and writes each file. Overwrites existing files.
   */
  installSkill(
    scope: ConfigScope,
    skillName: string,
    files: Array<{ name: string; content: string }>,
  ): Promise<void>;

  /**
   * Install a command by writing files to the scope's commands directory.
   *
   * For single-file commands, writes directly to the commands dir.
   * For multi-file commands, creates a subdirectory.
   */
  installCommand(
    scope: ConfigScope,
    commandName: string,
    files: Array<{ name: string; content: string }>,
  ): Promise<void>;

  /**
   * Install a hook by adding a matcher group to the scope's settings file.
   *
   * Routes to the existing addHook writer with the correct file path.
   */
  installHook(
    scope: ConfigScope,
    eventName: string,
    matcherGroup: { matcher: string; hooks: unknown[] },
  ): Promise<void>;

  /**
   * Install a custom prompt / instruction from a local file.
   *
   * Present iff `capabilities.customPromptFileInstall`. The provider validates the
   * file, resolves its own target path, and copies it — the view only picks the
   * file and surfaces the result. Returns `conflict` when a file already exists
   * and `options.overwrite` is not set.
   */
  installCustomPromptFile?(
    sourcePath: string,
    options?: { overwrite?: boolean },
  ): Promise<CustomPromptInstallResult>;
}
