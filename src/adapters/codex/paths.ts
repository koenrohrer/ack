import * as path from 'path';
import { getHomeDir } from '../../utils/platform.js';

/**
 * Centralized file path constants for all Codex configuration files.
 *
 * ALL Codex file paths must come from this module. No other module
 * should construct paths to Codex config files directly.
 *
 * Codex uses TOML config files at `~/.codex/config.toml` (user scope)
 * and `.codex/config.toml` (project scope). MCP servers are defined
 * inside config.toml under the `[mcp_servers]` table -- there is no
 * separate MCP config file like Claude Code has.
 */
export const CodexPaths = {
  // ---------------------------------------------------------------------------
  // User scope (static -- based on home directory)
  // ---------------------------------------------------------------------------

  /** ~/.codex/ directory (for detection) */
  get userCodexDir(): string {
    return path.join(getHomeDir(), '.codex');
  },

  /** ~/.codex/config.toml */
  get userConfigToml(): string {
    return path.join(getHomeDir(), '.codex', 'config.toml');
  },

  /** ~/.codex/skills/ */
  get userSkillsDir(): string {
    return path.join(getHomeDir(), '.codex', 'skills');
  },

  /** ~/.codex/prompts/ */
  get userPromptsDir(): string {
    return path.join(getHomeDir(), '.codex', 'prompts');
  },

  // ---------------------------------------------------------------------------
  // Project scope (functions taking workspaceRoot)
  // ---------------------------------------------------------------------------

  /** {root}/.codex/ */
  projectCodexDir(root: string): string {
    return path.join(root, '.codex');
  },

  /** {root}/.codex/config.toml */
  projectConfigToml(root: string): string {
    return path.join(root, '.codex', 'config.toml');
  },

  /** {root}/.codex/skills/ */
  projectSkillsDir(root: string): string {
    return path.join(root, '.codex', 'skills');
  },

  /** {root}/.codex/prompts/ */
  projectPromptsDir(root: string): string {
    return path.join(root, '.codex', 'prompts');
  },
} as const;
