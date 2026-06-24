import * as path from 'path';
import { getHomeDir, getManagedConfigDir } from '../../utils/platform.js';

/**
 * Centralized file path constants for all Claude Code configuration files.
 *
 * ALL Claude Code file paths must come from this module. No other module
 * should construct paths to Claude Code config files directly.
 */
export const ClaudeCodePaths = {
  // ---------------------------------------------------------------------------
  // User scope (static -- based on home directory)
  // ---------------------------------------------------------------------------

  /** ~/.claude/settings.json */
  get userSettingsJson(): string {
    return path.join(getHomeDir(), '.claude', 'settings.json');
  },

  /** ~/.claude.json */
  get userClaudeJson(): string {
    return path.join(getHomeDir(), '.claude.json');
  },

  /** ~/.claude/skills/ */
  get userSkillsDir(): string {
    return path.join(getHomeDir(), '.claude', 'skills');
  },

  /** ~/.claude/commands/ */
  get userCommandsDir(): string {
    return path.join(getHomeDir(), '.claude', 'commands');
  },

  /** ~/.claude/ directory (for detection) */
  get userClaudeDir(): string {
    return path.join(getHomeDir(), '.claude');
  },

  // ---------------------------------------------------------------------------
  // Project scope (functions taking workspaceRoot)
  // ---------------------------------------------------------------------------

  /** {root}/.claude/settings.json */
  projectSettingsJson(root: string): string {
    return path.join(root, '.claude', 'settings.json');
  },

  /** {root}/.claude/settings.local.json */
  projectLocalSettingsJson(root: string): string {
    return path.join(root, '.claude', 'settings.local.json');
  },

  /** {root}/.mcp.json */
  projectMcpJson(root: string): string {
    return path.join(root, '.mcp.json');
  },

  /** {root}/.claude/skills/ */
  projectSkillsDir(root: string): string {
    return path.join(root, '.claude', 'skills');
  },

  /** {root}/.claude/commands/ */
  projectCommandsDir(root: string): string {
    return path.join(root, '.claude', 'commands');
  },

  // ---------------------------------------------------------------------------
  // Managed scope (static -- OS-dependent)
  // ---------------------------------------------------------------------------

  /** {managedDir}/managed-settings.json */
  get managedSettingsJson(): string {
    return path.join(getManagedConfigDir(), 'managed-settings.json');
  },

  /** {managedDir}/managed-mcp.json */
  get managedMcpJson(): string {
    return path.join(getManagedConfigDir(), 'managed-mcp.json');
  },
} as const;
