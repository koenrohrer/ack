/**
 * GitHub Search Discovery Service.
 *
 * Queries the GitHub REST API to discover compatible tools from public
 * repositories. Handles authentication (VS Code GitHub provider), dual
 * search strategy (repo search for broad queries, code search for
 * type-filtered filename matching), independent rate limit tracking,
 * and 30-minute result caching.
 *
 * No top-level vscode import -- dynamic require('vscode') is used inside
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

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Discovers compatible tools from public GitHub repositories.
 *
 * Primary public API:
 * - `search(options)` -- main entry point for all search flows
 * - `browseDiscovery()` -- trending/recent tool repos (no query)
 * - `promptForAuth()` -- prompt user for GitHub authentication
 * - `getAuthHeaders()` -- reusable headers for external consumers
 * - `getRateLimitState()` -- current rate limit snapshot
 * - `isNearRateLimit()` -- quick check for UI warning display
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
      // VS Code API not available (e.g., running in tests) -- fall through
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
   * 1. Check cache -- return fresh results immediately.
   * 2. If rate-limited -- return stale cache or empty array.
   * 3. typeFilter set + no text query -> code search (filename patterns),
   *    falling back to repo search if code search is rate-limited.
   * 4. text query set OR no typeFilter -> repository search.
   * 5. Neither query nor typeFilter -> browseDiscovery().
   *
   * Results are cached with the search options as key.
   */
  async search(options: GitHubSearchOptions = {}): Promise<GitHubSearchResult[]> {
    const cacheKey = this.buildCacheKey(options);
    const cached = this.searchCache.get(cacheKey);

    // Return fresh cache hit
    if (cached && Date.now() - cached.fetchedAt < GITHUB_SEARCH_CONSTANTS.CACHE_TTL_MS) {
      return cached.results;
    }

    // Determine which search endpoint to use
    const hasQuery = !!options.query?.trim();
    const hasTypeFilter = !!options.typeFilter;

    let results: GitHubSearchResult[];

    if (hasTypeFilter && !hasQuery) {
      // Type-filtered without text query: prefer code search for filename matching
      if (!this.isRateLimited(true)) {
        results = await this.searchCode(options.typeFilter!);
      } else if (!this.isRateLimited(false)) {
        // Code search rate-limited -- fall back to repo search
        results = await this.searchRepositories(options);
      } else {
        // Both rate-limited -- return stale cache or empty
        return cached?.results ?? [];
      }
    } else if (hasQuery || hasTypeFilter) {
      // Text query (with or without type filter): repo search
      if (this.isRateLimited(false)) {
        return cached?.results ?? [];
      }
      results = await this.searchRepositories(options);
    } else {
      // No query, no filter: browse discovery
      if (this.isRateLimited(false)) {
        return cached?.results ?? [];
      }
      results = await this.browseDiscovery();
    }

    // Cache results
    this.searchCache.set(cacheKey, {
      results,
      fetchedAt: Date.now(),
    });

    return results;
  }

  /**
   * Browse mode: discover trending/recent tool repos without a query.
   *
   * Uses repository search with topic-based queries. Does NOT use code
   * search (per RESEARCH.md rate limit strategy).
   */
  async browseDiscovery(): Promise<GitHubSearchResult[]> {
    // GitHub search API does not support OR between topic: qualifiers.
    // Use plain keywords that match against repo names and descriptions.
    const query = 'mcp-server OR claude-skill OR claude-tools OR claude-commands in:name,description,topics';
    const url =
      `${GITHUB_API_BASE}/search/repositories` +
      `?q=${encodeURIComponent(query)}` +
      `&sort=updated&order=desc` +
      `&per_page=${GITHUB_SEARCH_CONSTANTS.MAX_RESULTS_DEFAULT}`;

    const data = await this.fetchGitHub(url, false);
    const items = (data.items ?? []) as GitHubRepoItem[];

    return this.mapRepoResults(items);
  }

  // -------------------------------------------------------------------------
  // Core search implementations
  // -------------------------------------------------------------------------

  /**
   * Search GitHub repositories by keyword and/or tool type qualifiers.
   *
   * Builds a search query with:
   * - User text query (if provided)
   * - in:name,description qualifier
   * - archived:false, fork:false exclusions
   * - Type-specific qualifiers from TOOL_DETECTION_PATTERNS (if typeFilter set)
   */
  private async searchRepositories(
    options: GitHubSearchOptions,
  ): Promise<GitHubSearchResult[]> {
    const parts: string[] = [];

    if (options.query?.trim()) {
      parts.push(options.query.trim());
    }

    // Add type-specific qualifiers
    if (options.typeFilter) {
      const typeQualifiers = this.buildTypeQualifiers(options.typeFilter);
      if (typeQualifiers) {
        parts.push(typeQualifiers);
      }
    }

    parts.push('in:name,description');
    parts.push('archived:false');
    parts.push('fork:false');

    const perPage = options.maxResults ?? GITHUB_SEARCH_CONSTANTS.MAX_RESULTS_DEFAULT;
    const query = parts.join(' ');
    const url =
      `${GITHUB_API_BASE}/search/repositories` +
      `?q=${encodeURIComponent(query)}` +
      `&sort=stars&order=desc` +
      `&per_page=${perPage}`;

    const data = await this.fetchGitHub(url, false);
    const items = (data.items ?? []) as GitHubRepoItem[];

    let results = this.mapRepoResults(items);

    // If type filter is active, keep only matching results
    if (options.typeFilter) {
      results = results.filter((r) => r.detectedType === options.typeFilter);
    }

    return results;
  }

  /**
   * Search GitHub code by filename patterns for a specific tool type.
   *
   * Only called when a type filter is active without a text query.
   * Combines all filename patterns for the type with OR and deduplicates
   * results by repository.
   */
  private async searchCode(
    typeFilter: GitHubToolType,
  ): Promise<GitHubSearchResult[]> {
    const patterns = TOOL_DETECTION_PATTERNS[typeFilter];
    if (!patterns || patterns.length === 0) {
      return [];
    }

    // Build filename query: filename:SKILL.md OR filename:skill.md
    const filenameParts = patterns.map((p) => `filename:${p.filePattern}`);
    const query = filenameParts.join(' OR ');

    const url =
      `${GITHUB_API_BASE}/search/code` +
      `?q=${encodeURIComponent(query)}` +
      `&per_page=${GITHUB_SEARCH_CONSTANTS.MAX_RESULTS_DEFAULT}`;

    const data = await this.fetchGitHub(url, true);
    const items = (data.items ?? []) as GitHubCodeItem[];

    // Deduplicate by repository -- one result per repo for the given type
    const seenRepos = new Set<string>();
    const results: GitHubSearchResult[] = [];

    for (const item of items) {
      const repoFullName = item.repository.full_name;
      if (seenRepos.has(repoFullName)) {
        continue;
      }
      seenRepos.add(repoFullName);

      results.push({
        id: `github:${repoFullName}:${typeFilter}`,
        name: item.repository.name,
        description: item.repository.description ?? '',
        detectedType: typeFilter,
        author: item.repository.owner.login,
        repoFullName,
        repoUrl: item.repository.html_url,
        stars: item.repository.stargazers_count,
        language: item.repository.language,
        lastUpdated: item.repository.pushed_at,
        topics: item.repository.topics ?? [],
        defaultBranch: item.repository.default_branch,
      });
    }

    return results;
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
   *
   * @param isCodeSearch - true for code search, false for repo search
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

    // Handle rate limiting gracefully
    if (response.status === 403 || response.status === 429) {
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
   * Map GitHub repository API items to GitHubSearchResult[].
   *
   * For each repo, detectToolTypes() determines which types it provides.
   * Multi-detect repos produce one result per detected type.
   * Repos with no detected type are included with a best-guess from topics.
   */
  private mapRepoResults(items: GitHubRepoItem[]): GitHubSearchResult[] {
    const results: GitHubSearchResult[] = [];

    for (const repo of items) {
      const detectedTypes = this.detectToolTypes(repo);

      if (detectedTypes.length === 0) {
        // No clear signal -- include as a generic result with the first
        // matching topic type, or skip entirely
        continue;
      }

      // Multi-detect: one result per detected type
      for (const toolType of detectedTypes) {
        const suffix = detectedTypes.length > 1 ? `:${toolType}` : '';
        results.push({
          id: `github:${repo.full_name}:${toolType}${suffix ? '' : ''}`,
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

    return results;
  }

  /**
   * Detect tool types from a repository's metadata.
   *
   * Checks:
   * 1. Repository name against repoNamePattern regexes
   * 2. Repository topics against TOPIC_TO_TOOL_TYPE mapping
   *
   * Returns deduplicated array of detected types.
   * Empty array means no clear signal -- repo is skipped in results.
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
   * Build additional search qualifiers for a specific tool type.
   *
   * Used in repository search to narrow results based on naming
   * conventions and topic patterns.
   */
  private buildTypeQualifiers(toolType: GitHubToolType): string | null {
    // GitHub search API does not support OR between topic: qualifiers.
    // Use plain keywords matched against repo names and descriptions.
    switch (toolType) {
      case 'mcp_server':
        return 'mcp-server';
      case 'skill':
        return 'claude-skill OR skill';
      case 'hook':
        return 'claude-hooks OR hooks';
      case 'command':
        return 'claude-commands OR commands';
      case 'profile':
        return 'claude-profile OR profile';
      default:
        return null;
    }
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
