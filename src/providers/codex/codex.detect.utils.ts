/**
 * Pure detection logic for Codex, split out so it is unit-testable without
 * touching the filesystem or vscode.
 *
 * The presence of `~/.codex` alone is NOT a reliable signal: an unrelated tool
 * can own a `.codex` directory (e.g. sqlite/memory files) without being Codex.
 * We require at least one Codex-OWNED artifact — `config.toml`, a `prompts/`
 * directory, or a `skills/` directory — all of which Codex itself manages.
 *
 * Note: this intentionally detects a real install that has NOT written
 * `config.toml` yet (prompts/ or skills/ alone suffices) so the
 * "Codex detected but no config.toml -> create one?" flow stays reachable.
 */
export interface CodexMarkers {
  /** `~/.codex/config.toml` exists */
  configToml: boolean;
  /** `~/.codex/prompts/` exists */
  promptsDir: boolean;
  /** `~/.codex/skills/` exists */
  skillsDir: boolean;
}

/**
 * Decide whether Codex is installed from its on-disk markers.
 * True iff at least one Codex-owned artifact is present.
 */
export function isCodexInstalled(markers: CodexMarkers): boolean {
  return markers.configToml || markers.promptsDir || markers.skillsDir;
}
