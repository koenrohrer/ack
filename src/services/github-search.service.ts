/**
 * GitHub Search Discovery Service.
 *
 * Queries the GitHub REST API to discover compatible tools from public
 * repositories. Uses code search (filename: qualifier) as the primary
 * discovery strategy — the same approach used by SkillsMP and Vercel's
 * skills marketplace. Repository search supplements for keyword queries.
 *
 * No top-level vscode import — dynamic require('vscode') is used inside
 * methods that need the VS Code API, following the RegistryService pattern.
 */

import type {
  GitHubToolType,
  GitHubSearchResult,
  GitHubSearchOptions,
  GitHubRateLimitState,
  GitHubSearchCacheEntry,
  GitHubRepoItem,
  GitHubCodeItem,
} from './github-search.types.js';

import {
  TOOL_DETECTION_PATTERNS,
  TOPIC_TO_TOOL_TYPE,
  GITHUB_SEARCH_CONSTANTS,
} from './github-search.types.js';

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const GITHUB_API_BASE = 'https://api.github.com';

const BASE_HEADERS: Record<string, string> = {
  'Accept': 'application/vnd.github+json',
  'User-Agent': 'agent-config-keeper',
  'X-GitHub-Api-Version': '2022-11-28',
};

/**
 * Code search queries for browse discovery, segmented to maximize coverage.
 * Each query uses the filename: qualifier on /search/code.
 * Segmented by tool type so each returns distinct results.
 */
const BROWSE_QUERIES: { query: string; type: GitHubToolType }[] = [
  { query: 'filename:SKILL.md', type: 'skill' },
  { query: 'filename:.mcp.json', type: 'mcp_server' },
];

/**
 * Code search queries per tool type for filtered search.
 * Uses filename: and optional path: qualifiers on /search/code.
 */
const TYPE_CODE_QUERIES: Record<GitHubToolType, string[]> = {
  skill: ['filename:SKILL.md', 'filename:skill.md'],
  mcp_server: ['filename:.mcp.json', 'filename:mcp.json'],
  hook: ['filename:settings.json path:.claude'],
  command: ['path:.claude/commands'],
  profile: ['filename:agent-profile.json'],
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Discovers compatible tools from public GitHub repositories.
 *
 * Primary strategy: code search with filename: qualifier (like SkillsMP).
 * This finds repos that actually contain tool files (SKILL.md, .mcp.json, etc.)
 * rather than repos that just mention tools in their description.
 *
 * Public API:
 * - `search(options)` — main entry point for all search flows
 * - `browseDiscovery()` — discover repos containing tool files
 * - `promptForAuth()` — prompt user for GitHub authentication
 * - `getAuthHeaders()` — reusable headers for external consumers
 * - `getRateLimitState()` — current rate limit snapshot
 * - `isNearRateLimit()` — quick check for UI warning display
 */
export class GitHubSearchService {
  private readonly searchCache = new Map<string, GitHubSearchCacheEntry>();
  private codeSearchRateLimit: GitHubRateLimitState | null = null;
  private repoSearchRateLimit: GitHubRateLimitState | null = null;
  private cachedToken: string | null = null;
  private tokenFetchedAt = 0;

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  /**
   * Attempt to get a GitHub access token silently.
   *
   * Uses the VS Code GitHub authentication provider. If the user has
   * previously authenticated, the token is returned without any UI.
   * If not, returns null (caller should use promptForAuth() if needed).
   *
   * Token is cached for 60 seconds to avoid repeated getSession calls.
   */
  private async getAuthToken(): Promise<string | null> {
    // Return cached token if fresh (< 60s old)
    if (this.cachedToken && Date.now() - this.tokenFetchedAt < 60_000) {
      return this.cachedToken;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const vscodeApi = require('vscode') as typeof import('vscode');
      const session = await vscodeApi.authentication.getSession(
        'github',
        [],
        { silent: true },
      );

      if (session) {
        this.cachedToken = session.accessToken;
        this.tokenFetchedAt = Date.now();
        return this.cachedToken;
      }
    } catch {
      // VS Code API not available (e.g., running in tests) — fall through
    }

    this.cachedToken = null;
    return null;
  }

  /**
   * Prompt the user to authenticate with GitHub.
   *
   * Shows the VS Code authentication dialog. Returns true if the user
   * completed authentication, false if they dismissed.
   */
  async promptForAuth(): Promise<boolean> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const vscodeApi = require('vscode') as typeof import('vscode');
      const session = await vscodeApi.authentication.getSession(
        'github',
        [],
        { createIfNone: true },
      );

      if (session) {
        this.cachedToken = session.accessToken;
        this.tokenFetchedAt = Date.now();
        return true;
      }
    } catch {
      // User dismissed the dialog or VS Code API unavailable
    }

    return false;
  }

  /**
   * Build headers for authenticated GitHub API requests.
   *
   * Returns base headers (Accept, User-Agent, API version) plus an
   * Authorization header if a cached token is available. Shared by
   * MarketplacePanel for README fetches.
   */
  getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = { ...BASE_HEADERS };

    if (this.cachedToken) {
      headers['Authorization'] = `Bearer ${this.cachedToken}`;
    }

    return headers;
  }

  // -------------------------------------------------------------------------
  // Public search API
  // -------------------------------------------------------------------------

  /**
   * Main search entry point.
   *
   * Routing logic:
   * 1. Check cache — return fresh results immediately.
   * 2. If rate-limited — return stale cache or empty array.
   * 3. typeFilter set (with or without query) → code search with filename patterns.
   * 4. query set without typeFilter → code search for SKILL.md + .mcp.json with query term.
   * 5. Neither query nor typeFilter → browseDiscovery() (code search).
   *
   * Code search is the primary strategy. Repo search is only used as
   * supplementary source when a text query is provided.
   */
  async search(options: GitHubSearchOptions = {}): Promise<GitHubSearchResult[]> {
    const cacheKey = this.buildCacheKey(options);
    const cached = this.searchCache.get(cacheKey);

    // Return fresh cache hit
    if (cached && Date.now() - cached.fetchedAt < GITHUB_SEARCH_CONSTANTS.CACHE_TTL_MS) {
      return cached.results;
    }

    const hasQuery = !!options.query?.trim();
    const hasTypeFilter = !!options.typeFilter;

    let results: GitHubSearchResult[];

    if (this.isRateLimited(true) && this.isRateLimited(false)) {
      // Both endpoints rate-limited — return stale cache or empty
      return cached?.results ?? [];
    }

    if (!hasQuery && !hasTypeFilter) {
      // Browse mode: discover repos containing tool files
      results = await this.browseDiscovery();
    } else if (hasTypeFilter) {
      // Type filter active: code search for that type's filename patterns
      results = await this.searchByType(options.typeFilter!, options.query);
    } else {
      // Text query only: code search for common tool files + repo search supplement
      results = await this.searchByQuery(options.query!);
    }

    // Cache results
    this.searchCache.set(cacheKey, {
      results,
      fetchedAt: Date.now(),
    });

    return results;
  }

  /**
   * Browse mode: discover repos that contain tool files.
   *
   * Uses code search with filename: qualifier — the same strategy as
   * SkillsMP. Queries for SKILL.md and .mcp.json files to find repos
   * that actually contain tools, not just repos that mention them.
   *
   * Multiple queries are run sequentially (not parallel) to respect
   * the 10 req/min code search rate limit.
   */
  async browseDiscovery(): Promise<GitHubSearchResult[]> {
    const allResults: GitHubSearchResult[] = [];
    const seenRepos = new Set<string>();

    for (const { query, type } of BROWSE_QUERIES) {
      if (this.isRateLimited(true)) {
        break;
      }

      const url =
        `${GITHUB_API_BASE}/search/code` +
        `?q=${encodeURIComponent(query)}` +
        `&sort=indexed&order=desc` +
        `&per_page=${GITHUB_SEARCH_CONSTANTS.MAX_RESULTS_DEFAULT}`;

      const data = await this.fetchGitHub(url, true);
      const items = (data.items ?? []) as GitHubCodeItem[];

      for (const item of items) {
        const repoFullName = item.repository.full_name;
        if (seenRepos.has(repoFullName)) {
          continue;
        }
        seenRepos.add(repoFullName);

        allResults.push(this.codeItemToResult(item, type));
      }
    }

    // Sort by stars descending
    allResults.sort((a, b) => b.stars - a.stars);

    return allResults.slice(0, GITHUB_SEARCH_CONSTANTS.MAX_RESULTS_DEFAULT);
  }

  // -------------------------------------------------------------------------
  // Core search implementations
  // -------------------------------------------------------------------------

  /**
   * Search by tool type using code search with filename patterns.
   *
   * Optionally includes a text query term alongside the filename qualifier.
   * For example: `filename:SKILL.md react` finds skills related to React.
   */
  private async searchByType(
    typeFilter: GitHubToolType,
    query?: string,
  ): Promise<GitHubSearchResult[]> {
    const codeQueries = TYPE_CODE_QUERIES[typeFilter];
    if (!codeQueries || codeQueries.length === 0) {
      return [];
    }

    const allResults: GitHubSearchResult[] = [];
    const seenRepos = new Set<string>();
    const queryTerm = query?.trim() ?? '';

    for (const codeQuery of codeQueries) {
      if (this.isRateLimited(true)) {
        break;
      }

      // Combine filename pattern with optional text query
      const fullQuery = queryTerm
        ? `${codeQuery} ${queryTerm}`
        : codeQuery;

      const url =
        `${GITHUB_API_BASE}/search/code` +
        `?q=${encodeURIComponent(fullQuery)}` +
        `&per_page=${GITHUB_SEARCH_CONSTANTS.MAX_RESULTS_DEFAULT}`;

      const data = await this.fetchGitHub(url, true);
      const items = (data.items ?? []) as GitHubCodeItem[];

      for (const item of items) {
        const repoFullName = item.repository.full_name;
        if (seenRepos.has(repoFullName)) {
          continue;
        }
        seenRepos.add(repoFullName);

        allResults.push(this.codeItemToResult(item, typeFilter));
      }
    }

    // Sort by stars descending
    allResults.sort((a, b) => b.stars - a.stars);

    return allResults;
  }

  /**
   * Search by keyword across all tool types.
   *
   * Uses code search with filename patterns + the query term.
   * Also supplements with repo search for broader coverage.
   */
  private async searchByQuery(
    query: string,
  ): Promise<GitHubSearchResult[]> {
    const allResults: GitHubSearchResult[] = [];
    const seenRepos = new Set<string>();
    const trimmed = query.trim();

    // 1. Code search: find SKILL.md and .mcp.json files matching the query
    const codeSearchQueries = [
      { q: `filename:SKILL.md ${trimmed}`, type: 'skill' as GitHubToolType },
      { q: `filename:.mcp.json ${trimmed}`, type: 'mcp_server' as GitHubToolType },
    ];

    for (const { q, type } of codeSearchQueries) {
      if (this.isRateLimited(true)) {
        break;
      }

      const url =
        `${GITHUB_API_BASE}/search/code` +
        `?q=${encodeURIComponent(q)}` +
        `&per_page=15`;

      const data = await this.fetchGitHub(url, true);
      const items = (data.items ?? []) as GitHubCodeItem[];

      for (const item of items) {
        const repoFullName = item.repository.full_name;
        if (seenRepos.has(repoFullName)) {
          continue;
        }
        seenRepos.add(repoFullName);

        allResults.push(this.codeItemToResult(item, type));
      }
    }

    // 2. Repo search supplement: find repos with tool-related names/topics
    if (!this.isRateLimited(false)) {
      const repoQuery = `${trimmed} in:name,description archived:false fork:false`;
      const url =
        `${GITHUB_API_BASE}/search/repositories` +
        `?q=${encodeURIComponent(repoQuery)}` +
        `&sort=stars&order=desc` +
        `&per_page=15`;

      const data = await this.fetchGitHub(url, false);
      const items = (data.items ?? []) as GitHubRepoItem[];

      for (const repo of items) {
        if (seenRepos.has(repo.full_name)) {
          continue;
        }

        const detectedTypes = this.detectToolTypes(repo);
        if (detectedTypes.length === 0) {
          continue;
        }

        seenRepos.add(repo.full_name);

        for (const toolType of detectedTypes) {
          allResults.push({
            id: `github:${repo.full_name}:${toolType}`,
            name: repo.name,
            description: repo.description ?? '',
            detectedType: toolType,
            author: repo.owner.login,
            repoFullName: repo.full_name,
            repoUrl: repo.html_url,
            stars: repo.stargazers_count,
            language: repo.language,
            lastUpdated: repo.pushed_at,
            topics: repo.topics ?? [],
            defaultBranch: repo.default_branch,
          });
        }
      }
    }

    // Sort by stars descending
    allResults.sort((a, b) => b.stars - a.stars);

    return allResults.slice(0, GITHUB_SEARCH_CONSTANTS.MAX_RESULTS_DEFAULT);
  }

  // -------------------------------------------------------------------------
  // Rate limit helpers
  // -------------------------------------------------------------------------

  /**
   * Returns current rate limit state for both search endpoints.
   * Used by UI to display rate limit indicators.
   */
  getRateLimitState(): {
    codeSearch: GitHubRateLimitState | null;
    repoSearch: GitHubRateLimitState | null;
  } {
    return {
      codeSearch: this.codeSearchRateLimit,
      repoSearch: this.repoSearchRateLimit,
    };
  }

  /**
   * Returns true if either rate limit has fewer than 3 remaining requests.
   * Used by UI for warning display.
   */
  isNearRateLimit(): boolean {
    const checkLimit = (state: GitHubRateLimitState | null): boolean => {
      if (!state) {
        return false;
      }
      return state.remaining < 3 && state.resetAt > Date.now() / 1000;
    };

    return checkLimit(this.codeSearchRateLimit) || checkLimit(this.repoSearchRateLimit);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Check if a search endpoint is currently rate-limited.
   */
  private isRateLimited(isCodeSearch: boolean): boolean {
    const state = isCodeSearch ? this.codeSearchRateLimit : this.repoSearchRateLimit;
    if (!state) {
      return false;
    }
    return state.remaining === 0 && state.resetAt > Date.now() / 1000;
  }

  /**
   * Perform an authenticated GitHub API request.
   *
   * All GitHub API calls route through this method for consistent
   * authentication and rate limit tracking.
   *
   * On rate limit (403/429): updates rate limit state, returns { items: [] }.
   * On 422 (invalid query): returns { items: [] } (don't throw for bad queries).
   * On other HTTP errors: throws.
   */
  private async fetchGitHub(
    url: string,
    isCodeSearch: boolean,
  ): Promise<{ items: unknown[] }> {
    const token = await this.getAuthToken();

    const headers: Record<string, string> = { ...BASE_HEADERS };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, { headers });

    // Update rate limit state from response headers
    this.updateRateLimitFromHeaders(response.headers, isCodeSearch);

    // Handle rate limiting and bad queries gracefully
    if (response.status === 403 || response.status === 429 || response.status === 422) {
      return { items: [] };
    }

    if (!response.ok) {
      throw new Error(
        `GitHub API error: HTTP ${response.status} for ${url}`,
      );
    }

    return (await response.json()) as { items: unknown[] };
  }

  /**
   * Parse rate limit headers from a GitHub API response and update
   * the appropriate rate limit state.
   */
  private updateRateLimitFromHeaders(
    headers: Headers,
    isCodeSearch: boolean,
  ): void {
    const remaining = headers.get('x-ratelimit-remaining');
    const limit = headers.get('x-ratelimit-limit');
    const reset = headers.get('x-ratelimit-reset');

    if (remaining !== null && limit !== null && reset !== null) {
      const state: GitHubRateLimitState = {
        remaining: parseInt(remaining, 10),
        limit: parseInt(limit, 10),
        resetAt: parseInt(reset, 10),
      };

      if (isCodeSearch) {
        this.codeSearchRateLimit = state;
      } else {
        this.repoSearchRateLimit = state;
      }
    }
  }

  /**
   * Convert a code search result item to a GitHubSearchResult.
   */
  private codeItemToResult(
    item: GitHubCodeItem,
    detectedType: GitHubToolType,
  ): GitHubSearchResult {
    return {
      id: `github:${item.repository.full_name}:${detectedType}`,
      name: item.repository.name,
      description: item.repository.description ?? '',
      detectedType,
      author: item.repository.owner.login,
      repoFullName: item.repository.full_name,
      repoUrl: item.repository.html_url,
      stars: item.repository.stargazers_count,
      language: item.repository.language,
      lastUpdated: item.repository.pushed_at,
      topics: item.repository.topics ?? [],
      defaultBranch: item.repository.default_branch,
    };
  }

  /**
   * Detect tool types from a repository's metadata.
   *
   * Checks:
   * 1. Repository name against repoNamePattern regexes
   * 2. Repository topics against TOPIC_TO_TOOL_TYPE mapping
   *
   * Returns deduplicated array of detected types.
   * Empty array means no clear signal — repo is skipped in results.
   */
  private detectToolTypes(repo: GitHubRepoItem): GitHubToolType[] {
    const types = new Set<GitHubToolType>();

    // Check repo name against detection patterns
    for (const [toolType, patterns] of Object.entries(TOOL_DETECTION_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.repoNamePattern && pattern.repoNamePattern.test(repo.name)) {
          types.add(toolType as GitHubToolType);
        }
      }
    }

    // Check repo topics against topic mapping
    for (const topic of repo.topics ?? []) {
      const mappedType = TOPIC_TO_TOOL_TYPE[topic];
      if (mappedType) {
        types.add(mappedType);
      }
    }

    return [...types];
  }

  /**
   * Build a deterministic cache key from search options.
   */
  private buildCacheKey(options: GitHubSearchOptions): string {
    const parts = [
      options.query?.trim() ?? '',
      options.typeFilter ?? '',
      String(options.maxResults ?? GITHUB_SEARCH_CONSTANTS.MAX_RESULTS_DEFAULT),
    ];
    return parts.join('::');
  }
}
