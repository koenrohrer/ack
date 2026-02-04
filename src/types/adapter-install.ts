import type { ConfigScope } from './enums.js';

/**
 * Tool installation capability interface.
 *
 * Handles writing tool content (skills, commands, hooks) to the
 * correct scope-specific location. The adapter manages directory
 * creation and file writing internally.
 */
export interface IInstallAdapter {
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
}
