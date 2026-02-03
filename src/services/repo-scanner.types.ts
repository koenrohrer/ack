/**
 * Types for the repository scanner service.
 *
 * Used by RepoScannerService to scan GitHub repos for compatible tools
 * and persist results across sessions via VS Code globalState.
 */

// ---------------------------------------------------------------------------
// Scanned tool
// ---------------------------------------------------------------------------

/** A single tool detected within a scanned repository. */
export interface ScannedTool {
  /** Unique identifier: `repo:${repoFullName}:${toolType}:${name}` */
  id: string;
  /** Display name (e.g., parent dir name for skills, server key for MCP). */
  name: string;
  /** Detected tool type. */
  toolType: 'skill' | 'mcp_server' | 'command';
  /** Description extracted from file content or repo description. */
  description: string;
  /** Repository owner. */
  author: string;
  /** Full HTML URL of the repository. */
  repoUrl: string;
  /** owner/repo format. */
  repoFullName: string;
  /** Default branch name. */
  defaultBranch: string;
  /** Path within the repo where the tool was detected (e.g., "my-skill/SKILL.md"). */
  repoPath: string;
  /** All file paths relevant to this tool (for install). */
  files: string[];
}

// ---------------------------------------------------------------------------
// Scan result
// ---------------------------------------------------------------------------

/** Result of scanning a single repository. */
export interface RepoScanResult {
  /** The URL that was scanned. */
  repoUrl: string;
  /** owner/repo format. */
  repoFullName: string;
  /** Default branch name. */
  defaultBranch: string;
  /** Tools found in the repo. */
  tools: ScannedTool[];
  /** ISO timestamp of when the scan completed. */
  scannedAt: string;
  /** Error message if scan failed. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Shape stored in globalState for cache persistence across sessions. */
export interface PersistedRepoScan {
  /** The URL that was scanned. */
  repoUrl: string;
  /** owner/repo format. */
  repoFullName: string;
  /** Default branch. */
  defaultBranch: string;
  /** Scanned tools. */
  tools: ScannedTool[];
  /** ISO timestamp. */
  scannedAt: string;
}
