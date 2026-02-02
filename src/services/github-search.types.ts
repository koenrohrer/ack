/**
 * Types, constants, and detection patterns for GitHub search discovery.
 *
 * Used by GitHubSearchService to query the GitHub REST API and normalize
 * results into a unified format for the marketplace webview.
 */

// ---------------------------------------------------------------------------
// Tool type union
// ---------------------------------------------------------------------------

/** Tool types discoverable via GitHub search. Extends existing ToolType with 'profile'. */
export type GitHubToolType =
  | 'skill'
  | 'mcp_server'
  | 'hook'
  | 'command'
  | 'profile';

// ---------------------------------------------------------------------------
// Detection patterns
// ---------------------------------------------------------------------------

/** A single file/name pattern used to identify a tool type in a GitHub repo. */
export interface ToolDetectionPattern {
  /** Filename used in GitHub code search `filename:` qualifier. */
  filePattern: string;
  /** Optional regex matched against the repository name. */
  repoNamePattern?: RegExp;
  /** Optional keyword matched against package.json keywords field. */
  packageKeyword?: string;
}

/**
 * Mapping from tool type to the patterns that indicate a repo contains
 * that type of tool. Used for both code search queries and repo-level
 * heuristic detection.
 */
export const TOOL_DETECTION_PATTERNS: Readonly<
  Record<GitHubToolType, readonly ToolDetectionPattern[]>
> = {
  skill: [
    { filePattern: 'SKILL.md' },
    { filePattern: 'skill.md' },
  ],
  mcp_server: [
    { filePattern: '.mcp.json' },
    { filePattern: 'mcp.json', repoNamePattern: /mcp-server/i, packageKeyword: 'mcp' },
  ],
  hook: [
    // Code search for hooks is unreliable -- repo search fallback preferred.
    // settings.json in .claude/ path with hooks config.
    { filePattern: 'settings.json' },
  ],
  command: [
    // Files in .claude/commands/ path (markdown command definitions).
    { filePattern: '*.md' },
  ],
  profile: [
    { filePattern: 'agent-profile.json' },
    { filePattern: 'profile.json' },
  ],
} as const;

// ---------------------------------------------------------------------------
// Topic mapping for repo-level detection
// ---------------------------------------------------------------------------

/** Maps GitHub repo topics to tool types for heuristic detection. */
export const TOPIC_TO_TOOL_TYPE: Readonly<Record<string, GitHubToolType>> = {
  'claude-skill': 'skill',
  'claude-skills': 'skill',
  'mcp-server': 'mcp_server',
  'mcp-servers': 'mcp_server',
  'model-context-protocol': 'mcp_server',
  'claude-hooks': 'hook',
  'claude-commands': 'command',
  'claude-tools': 'command',
  'claude-profile': 'profile',
  'claude-profiles': 'profile',
} as const;

// ---------------------------------------------------------------------------
// Search result
// ---------------------------------------------------------------------------

/** A single discovered tool from GitHub search. */
export interface GitHubSearchResult {
  /** Unique identifier: `github:${owner}/${repo}:${detectedType}` */
  id: string;
  /** Repository name or extracted tool name. */
  name: string;
  /** Repository description or README excerpt. */
  description: string;
  /** The tool type detected for this result. */
  detectedType: GitHubToolType;
  /** Repository owner login. */
  author: string;
  /** Full repository name: owner/repo. */
  repoFullName: string;
  /** HTML URL for the repository. */
  repoUrl: string;
  /** Star count. */
  stars: number;
  /** Primary programming language, if any. */
  language: string | null;
  /** ISO date string from pushed_at. */
  lastUpdated: string;
  /** Repository topics used as tags. */
  topics: string[];
  /** Default branch name. */
  defaultBranch: string;
}

// ---------------------------------------------------------------------------
// Search options
// ---------------------------------------------------------------------------

/** Options for the public search() entry point. */
export interface GitHubSearchOptions {
  /** Text search term. */
  query?: string;
  /** Narrow results to a single tool type. */
  typeFilter?: GitHubToolType;
  /** Maximum results to return (default 30). */
  maxResults?: number;
}

// ---------------------------------------------------------------------------
// Rate limit tracking
// ---------------------------------------------------------------------------

/** Snapshot of GitHub API rate limit state for one endpoint category. */
export interface GitHubRateLimitState {
  /** Remaining requests in current window. */
  remaining: number;
  /** Total request limit for the window. */
  limit: number;
  /** Unix timestamp (seconds) when the window resets. */
  resetAt: number;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** A cached set of search results with a timestamp. */
export interface GitHubSearchCacheEntry {
  /** The cached results. */
  results: GitHubSearchResult[];
  /** Timestamp (Date.now()) when results were fetched. */
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// GitHub API response shapes (internal use)
// ---------------------------------------------------------------------------

/** Subset of a GitHub repository object relevant to search results. */
export interface GitHubRepoItem {
  full_name: string;
  name: string;
  description: string | null;
  owner: { login: string };
  html_url: string;
  stargazers_count: number;
  language: string | null;
  pushed_at: string;
  topics: string[];
  default_branch: string;
  fork: boolean;
  archived: boolean;
}

/** Subset of a GitHub code search result item. */
export interface GitHubCodeItem {
  name: string;
  path: string;
  repository: {
    full_name: string;
    name: string;
    description: string | null;
    owner: { login: string };
    html_url: string;
    stargazers_count: number;
    language: string | null;
    pushed_at: string;
    topics: string[];
    default_branch: string;
    fork: boolean;
    archived: boolean;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Configuration constants for GitHub search behavior. */
export const GITHUB_SEARCH_CONSTANTS = {
  /** Cache time-to-live: 30 minutes. */
  CACHE_TTL_MS: 30 * 60 * 1000,
  /** Default maximum results per search. */
  MAX_RESULTS_DEFAULT: 30,
  /** GitHub code search rate limit (authenticated): ~10 requests/min. */
  CODE_SEARCH_RATE_PER_MIN: 10,
  /** GitHub repo search rate limit (authenticated): ~30 requests/min. */
  REPO_SEARCH_RATE_PER_MIN: 30,
} as const;
