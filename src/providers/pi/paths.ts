import * as path from 'path';
import { getHomeDir } from '../../utils/platform.js';

/**
 * Centralized file path constants for all Pi configuration files.
 *
 * ALL Pi file paths must come from this module. No other module
 * should construct paths to Pi config files directly.
 *
 * Pi stores config as JSON under `~/.pi/agent/` (user scope) and
 * `.pi/` (project scope). MCP servers live in a standalone `mcp.json`
 * with a top-level `mcpServers` key (pi-mcp-extension format) -- there
 * is no separate per-scope settings file that defines them like Codex.
 */
export const PiPaths = {
  // ---------------------------------------------------------------------------
  // User scope (static -- based on home directory)
  // ---------------------------------------------------------------------------

  /** ~/.pi/agent/ directory (for detection) */
  get userPiAgentDir(): string {
    return path.join(getHomeDir(), '.pi', 'agent');
  },

  /** ~/.pi/agent/settings.json */
  get userSettingsJson(): string {
    return path.join(getHomeDir(), '.pi', 'agent', 'settings.json');
  },

  /** ~/.pi/agent/skills/ */
  get userSkillsDir(): string {
    return path.join(getHomeDir(), '.pi', 'agent', 'skills');
  },

  /** ~/.pi/agent/prompts/ */
  get userPromptsDir(): string {
    return path.join(getHomeDir(), '.pi', 'agent', 'prompts');
  },

  /** ~/.pi/agent/mcp.json */
  get userMcpJson(): string {
    return path.join(getHomeDir(), '.pi', 'agent', 'mcp.json');
  },

  // ---------------------------------------------------------------------------
  // Project scope (functions taking workspaceRoot)
  // ---------------------------------------------------------------------------

  /** {root}/.pi/ */
  projectPiDir(root: string): string {
    return path.join(root, '.pi');
  },

  /** {root}/.pi/skills/ */
  projectSkillsDir(root: string): string {
    return path.join(root, '.pi', 'skills');
  },

  /** {root}/.pi/prompts/ */
  projectPromptsDir(root: string): string {
    return path.join(root, '.pi', 'prompts');
  },

  /** {root}/.pi/mcp.json */
  projectMcpJson(root: string): string {
    return path.join(root, '.pi', 'mcp.json');
  },
} as const;
