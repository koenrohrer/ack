/**
 * Repository Scanner Service.
 *
 * Scans GitHub repositories for compatible tools (skills, MCP servers,
 * commands) by fetching the repo tree and pattern-matching file paths.
 *
 * No top-level vscode import — dynamic require('vscode') is used inside
 * methods that need the VS Code API, following the existing service pattern.
 */

import type {
  ScannedTool,
  RepoScanResult,
  PersistedRepoScan,
} from './repo-scanner.types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITHUB_API_BASE = 'https://api.github.com';
const RAW_CONTENT_BASE = 'https://raw.githubusercontent.com';

const BASE_HEADERS: Record<string, string> = {
  'Accept': 'application/vnd.github+json',
  'User-Agent': 'ack',
  'X-GitHub-Api-Version': '2022-11-28',
};

const CACHE_KEY = 'ack.repoScanCache';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Scans GitHub repos for compatible tools and caches results.
 *
 * Public API:
 * - `parseRepoUrl(url)` — extract owner/repo from GitHub URL
 * - `scanRepo(url)` — scan a repo for tools
 * - `fetchRepoFile(repoFullName, branch, path)` — fetch raw file content
 * - `getCachedScan(url)` — get cached scan for a URL
 * - `getAllCachedScans()` — get all cached scans
 * - `removeCachedScan(url)` — remove a scan from cache
 */
export class RepoScannerService {
  private readonly memoryCache = new Map<string, RepoScanResult>();
  private cachedToken: string | null = null;
  private tokenFetchedAt = 0;

  /** globalState is injected for persistence. */
  private globalState: { get<T>(key: string, defaultValue: T): T; update(key: string, value: unknown): Thenable<void> } | null = null;

  constructor(globalState?: { get<T>(key: string, defaultValue: T): T; update(key: string, value: unknown): Thenable<void> }) {
    if (globalState) {
      this.globalState = globalState;
      // Hydrate memory cache from persisted state
      const persisted = globalState.get<PersistedRepoScan[]>(CACHE_KEY, []);
      for (const scan of persisted) {
        this.memoryCache.set(scan.repoUrl, {
          repoUrl: scan.repoUrl,
          repoFullName: scan.repoFullName,
          defaultBranch: scan.defaultBranch,
          tools: scan.tools,
          scannedAt: scan.scannedAt,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  private async getAuthToken(): Promise<string | null> {
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
      // VS Code API not available (tests) — fall through
    }

    this.cachedToken = null;
    return null;
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const token = await this.getAuthToken();
    const headers: Record<string, string> = { ...BASE_HEADERS };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  // -------------------------------------------------------------------------
  // URL parsing
  // -------------------------------------------------------------------------

  /**
   * Extract owner/repo from various GitHub URL formats.
   *
   * Supports:
   * - https://github.com/owner/repo
   * - https://github.com/owner/repo/tree/branch/...
   * - https://github.com/owner/repo.git
   * - github.com/owner/repo
   * - owner/repo (shorthand)
   *
   * Returns null if the URL cannot be parsed.
   */
  parseRepoUrl(url: string): { owner: string; repo: string } | null {
    const trimmed = url.trim();

    // Try full URL pattern
    const urlMatch = trimmed.match(
      /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/.#?]+)/,
    );
    if (urlMatch) {
      return { owner: urlMatch[1], repo: urlMatch[2] };
    }

    // Try shorthand: owner/repo
    const shortMatch = trimmed.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
    if (shortMatch) {
      return { owner: shortMatch[1], repo: shortMatch[2] };
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Repo scanning
  // -------------------------------------------------------------------------

  /**
   * Scan a GitHub repository for compatible tools.
   *
   * 1. Fetch repo info via /repos/{owner}/{repo}
   * 2. Fetch tree via /repos/{owner}/{repo}/git/trees/{branch}?recursive=1
   * 3. Walk tree matching tool patterns
   */
  async scanRepo(url: string): Promise<RepoScanResult> {
    const parsed = this.parseRepoUrl(url);
    if (!parsed) {
      return {
        repoUrl: url,
        repoFullName: '',
        defaultBranch: '',
        tools: [],
        scannedAt: new Date().toISOString(),
        error: 'Invalid GitHub repository URL',
      };
    }

    const { owner, repo } = parsed;
    const headers = await this.getHeaders();

    try {
      // 1. Fetch repo info
      const repoResponse = await fetch(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}`,
        { headers },
      );

      if (!repoResponse.ok) {
        const status = repoResponse.status;
        const errorMsg = status === 404
          ? 'Repository not found'
          : status === 403
            ? 'Rate limited or access denied. Try signing in with GitHub.'
            : `GitHub API error: HTTP ${status}`;
        return {
          repoUrl: url,
          repoFullName: `${owner}/${repo}`,
          defaultBranch: '',
          tools: [],
          scannedAt: new Date().toISOString(),
          error: errorMsg,
        };
      }

      const repoData = await repoResponse.json() as {
        full_name: string;
        html_url: string;
        default_branch: string;
        description: string | null;
        owner: { login: string };
      };

      const repoFullName = repoData.full_name;
      const defaultBranch = repoData.default_branch;
      const repoHtmlUrl = repoData.html_url;
      const repoDescription = repoData.description ?? '';
      const repoOwner = repoData.owner.login;

      // 2. Fetch tree
      const treeResponse = await fetch(
        `${GITHUB_API_BASE}/repos/${repoFullName}/git/trees/${defaultBranch}?recursive=1`,
        { headers },
      );

      if (!treeResponse.ok) {
        return {
          repoUrl: url,
          repoFullName,
          defaultBranch,
          tools: [],
          scannedAt: new Date().toISOString(),
          error: `Failed to fetch repository tree: HTTP ${treeResponse.status}`,
        };
      }

      const treeData = await treeResponse.json() as {
        tree: Array<{ path: string; type: string }>;
        truncated: boolean;
      };

      const filePaths = treeData.tree
        .filter((item) => item.type === 'blob')
        .map((item) => item.path);

      // 3. Detect tools
      const tools = this.detectTools(
        filePaths,
        repoFullName,
        repoHtmlUrl,
        defaultBranch,
        repoOwner,
        repoDescription,
      );

      // 4. Enrich tools with descriptions from their primary files
      await this.enrichDescriptions(tools, repoFullName, defaultBranch);

      const result: RepoScanResult = {
        repoUrl: url,
        repoFullName,
        defaultBranch,
        tools,
        scannedAt: new Date().toISOString(),
      };

      // Cache result
      this.memoryCache.set(url, result);
      void this.persistCache();

      return result;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Scan failed';
      return {
        repoUrl: url,
        repoFullName: `${owner}/${repo}`,
        defaultBranch: '',
        tools: [],
        scannedAt: new Date().toISOString(),
        error: errorMsg,
      };
    }
  }

  // -------------------------------------------------------------------------
  // File fetching
  // -------------------------------------------------------------------------

  /**
   * Fetch raw file content from a GitHub repository.
   *
   * Uses raw.githubusercontent.com for direct file access.
   */
  async fetchRepoFile(
    repoFullName: string,
    branch: string,
    path: string,
  ): Promise<string> {
    const url = `${RAW_CONTENT_BASE}/${repoFullName}/${branch}/${path}`;
    const headers = await this.getHeaders();
    // raw.githubusercontent.com doesn't use API headers, but auth token still works
    const rawHeaders: Record<string, string> = {};
    if (headers['Authorization']) {
      rawHeaders['Authorization'] = headers['Authorization'];
    }

    const response = await fetch(url, { headers: rawHeaders });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${path}: HTTP ${response.status}`);
    }
    return response.text();
  }

  // -------------------------------------------------------------------------
  // Cache management
  // -------------------------------------------------------------------------

  getCachedScan(url: string): RepoScanResult | undefined {
    return this.memoryCache.get(url);
  }

  getAllCachedScans(): RepoScanResult[] {
    return [...this.memoryCache.values()];
  }

  removeCachedScan(url: string): void {
    this.memoryCache.delete(url);
    void this.persistCache();
  }

  private async persistCache(): Promise<void> {
    if (!this.globalState) return;

    const scans: PersistedRepoScan[] = [];
    for (const result of this.memoryCache.values()) {
      if (!result.error) {
        scans.push({
          repoUrl: result.repoUrl,
          repoFullName: result.repoFullName,
          defaultBranch: result.defaultBranch,
          tools: result.tools,
          scannedAt: result.scannedAt,
        });
      }
    }
    await this.globalState.update(CACHE_KEY, scans);
  }

  // -------------------------------------------------------------------------
  // Description enrichment
  // -------------------------------------------------------------------------

  /**
   * Fetch each tool's primary file and extract a description from its content.
   *
   * Falls back to the existing description (repo-level) on fetch failure.
   * Fetches are done in parallel with individual error handling so one
   * failure doesn't block the others.
   */
  private async enrichDescriptions(
    tools: ScannedTool[],
    repoFullName: string,
    defaultBranch: string,
  ): Promise<void> {
    await Promise.all(
      tools.map(async (tool) => {
        // MCP servers use .mcp.json which has no prose description — skip
        if (tool.toolType === 'mcp_server') return;

        try {
          const content = await this.fetchRepoFile(
            repoFullName,
            defaultBranch,
            tool.repoPath,
          );
          const extracted = this.extractDescription(content);
          if (extracted) {
            tool.description = extracted;
          }
        } catch {
          // Keep the repo-level fallback description
        }
      }),
    );
  }

  /**
   * Extract a short description from markdown file content.
   *
   * Looks for (in order):
   * 1. YAML front matter `description:` field
   * 2. A blockquote line ("> ...") in the body
   * 3. The first non-empty paragraph after any leading heading
   *
   * Returns null if nothing useful is found.
   */
  private extractDescription(markdown: string): string | null {
    let body = markdown;

    // Pass 0: parse YAML front matter (delimited by --- lines)
    if (markdown.startsWith('---')) {
      const endIndex = markdown.indexOf('\n---', 3);
      if (endIndex !== -1) {
        const frontMatter = markdown.slice(3, endIndex);
        // Extract description field with a simple regex
        const descMatch = frontMatter.match(/^description:\s*(.+)$/m);
        if (descMatch) {
          const desc = descMatch[1].trim();
          if (desc.length > 0) {
            return desc.length > 200 ? desc.slice(0, 200) + '...' : desc;
          }
        }
        // Strip front matter from body for subsequent passes
        body = markdown.slice(endIndex + 4).trim();
      }
    }

    const lines = body.split('\n');

    // Pass 1: look for a blockquote tagline
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('>')) {
        const text = trimmed.replace(/^>+\s*/, '').trim();
        if (text.length > 0) {
          return text.length > 200 ? text.slice(0, 200) + '...' : text;
        }
      }
    }

    // Pass 2: first non-empty, non-heading paragraph
    let pastHeading = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') {
        continue;
      }
      if (trimmed.startsWith('#')) {
        pastHeading = true;
        continue;
      }
      if (/^[-=]{3,}$/.test(trimmed) || trimmed.startsWith('```')) {
        continue;
      }
      if (pastHeading || !lines[0]?.trim().startsWith('#')) {
        return trimmed.length > 200 ? trimmed.slice(0, 200) + '...' : trimmed;
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Tool detection
  // -------------------------------------------------------------------------

  /**
   * Walk file paths and detect tools by pattern matching.
   *
   * Patterns:
   * - any-path/SKILL.md -> skill (name from parent directory)
   * - Root .mcp.json -> MCP server(s)
   * - .claude/commands/name.md or commands/name.md -> commands
   */
  private detectTools(
    filePaths: string[],
    repoFullName: string,
    repoUrl: string,
    defaultBranch: string,
    author: string,
    repoDescription: string,
  ): ScannedTool[] {
    const tools: ScannedTool[] = [];

    // Track detected skills by directory to avoid duplicates
    const skillDirs = new Set<string>();

    for (const path of filePaths) {
      const lowerPath = path.toLowerCase();

      // --- Skills: **/SKILL.md ---
      if (lowerPath.endsWith('/skill.md') || lowerPath === 'skill.md') {
        const parts = path.split('/');
        // Name from parent directory, or repo name if at root
        const name = parts.length > 1 ? parts[parts.length - 2] : repoFullName.split('/')[1];
        const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';

        if (skillDirs.has(dir)) continue;
        skillDirs.add(dir);

        // Collect all files in the skill directory
        const prefix = dir ? `${dir}/` : '';
        const skillFiles = filePaths.filter(
          (p) => p === path || (prefix && p.startsWith(prefix) && p !== path),
        );

        tools.push({
          id: `repo:${repoFullName}:skill:${name}`,
          name,
          toolType: 'skill',
          description: repoDescription,
          author,
          repoUrl,
          repoFullName,
          defaultBranch,
          repoPath: path,
          files: skillFiles.length > 0 ? skillFiles : [path],
        });
      }

      // --- MCP servers: root .mcp.json ---
      if (path === '.mcp.json') {
        tools.push({
          id: `repo:${repoFullName}:mcp_server:${repoFullName.split('/')[1]}`,
          name: repoFullName.split('/')[1],
          toolType: 'mcp_server',
          description: repoDescription,
          author,
          repoUrl,
          repoFullName,
          defaultBranch,
          repoPath: path,
          files: [path],
        });
      }

      // --- Commands: .claude/commands/*.md or commands/*.md ---
      if (
        (lowerPath.startsWith('.claude/commands/') || lowerPath.startsWith('commands/')) &&
        lowerPath.endsWith('.md')
      ) {
        const fileName = path.split('/').pop()!;
        const commandName = fileName.replace(/\.md$/i, '');

        tools.push({
          id: `repo:${repoFullName}:command:${commandName}`,
          name: commandName,
          toolType: 'command',
          description: `Custom command from ${repoFullName}`,
          author,
          repoUrl,
          repoFullName,
          defaultBranch,
          repoPath: path,
          files: [path],
        });
      }
    }

    return tools;
  }
}
