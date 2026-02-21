import * as path from 'path';

/**
 * Centralized file path helpers for all GitHub Copilot configuration files.
 *
 * ALL Copilot file paths must come from this module. No other module
 * should construct paths to Copilot config files directly.
 *
 * Copilot uses:
 * - User MCP at `{vsCodeUserDir}/mcp.json` — vsCodeUserDir is derived from
 *   context.globalStorageUri at adapter construction time (not os.homedir())
 * - Workspace MCP at `.vscode/mcp.json`
 * - Copilot instructions at `.github/copilot-instructions.md`
 * - Per-file instructions at `.github/instructions/`
 * - Reusable prompts at `.github/prompts/`
 * - Agent definitions at `.github/agents/`
 */
export const CopilotPaths = {
  // ---------------------------------------------------------------------------
  // User scope — vsCodeUserDir is derived from context.globalStorageUri
  //              at adapter construction time (path.dirname twice)
  // ---------------------------------------------------------------------------

  /**
   * {vsCodeUserDir}/mcp.json — Copilot user-scope MCP configuration.
   *
   * vsCodeUserDir = path.dirname(path.dirname(context.globalStorageUri.fsPath))
   * which resolves to .../Code/User/ on all platforms.
   */
  userMcpJson(vsCodeUserDir: string): string {
    return path.join(vsCodeUserDir, 'mcp.json');
  },

  // ---------------------------------------------------------------------------
  // Workspace scope — functions taking workspaceRoot
  // ---------------------------------------------------------------------------

  /**
   * {root}/.vscode/mcp.json — Copilot workspace-scope MCP configuration.
   */
  workspaceMcpJson(root: string): string {
    return path.join(root, '.vscode', 'mcp.json');
  },

  /**
   * {root}/.github/copilot-instructions.md — Global Copilot instructions file.
   */
  workspaceCopilotInstructionsFile(root: string): string {
    return path.join(root, '.github', 'copilot-instructions.md');
  },

  /**
   * {root}/.github/instructions/ — Per-file instruction overrides directory.
   */
  workspaceInstructionsDir(root: string): string {
    return path.join(root, '.github', 'instructions');
  },

  /**
   * {root}/.github/prompts/ — Reusable prompt files directory.
   */
  workspacePromptsDir(root: string): string {
    return path.join(root, '.github', 'prompts');
  },

  /**
   * {root}/.github/agents/ — Agent definition files directory.
   */
  workspaceAgentsDir(root: string): string {
    return path.join(root, '.github', 'agents');
  },
} as const;
