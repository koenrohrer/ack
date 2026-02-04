import type { ConfigScope } from './enums.js';

/**
 * Path resolution capability interface.
 *
 * Provides scope-aware directory and file path lookups so services
 * never need to know about platform-specific file locations.
 */
export interface IPathAdapter {
  /**
   * Return the skills directory path for the given scope.
   *
   * Throws AdapterScopeError for scopes that don't support skills.
   */
  getSkillsDir(scope: ConfigScope): string;

  /**
   * Return the commands directory path for the given scope.
   *
   * Throws AdapterScopeError for scopes that don't support commands.
   */
  getCommandsDir(scope: ConfigScope): string;

  /**
   * Return the settings file path for the given scope.
   *
   * For Claude Code:
   * - User -> ~/.claude/settings.json
   * - Project -> {root}/.claude/settings.json
   * - Local -> {root}/.claude/settings.local.json
   *
   * Throws AdapterScopeError for scopes that don't have a settings file.
   */
  getSettingsPath(scope: ConfigScope): string;
}
