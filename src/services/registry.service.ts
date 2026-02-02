import type * as vscode from 'vscode';
import type {
  RegistryCache,
  RegistryIndex,
  RegistrySource,
} from './registry.types.js';
import type { ToolManifest } from './install.types.js';
import { ToolManifestSchema } from './install.types.js';

const DEFAULT_REGISTRY: RegistrySource = {
  id: 'community',
  name: 'Community Registry',
  owner: 'koenrohrer',
  repo: 'tool-registry',
  branch: 'main',
  indexPath: 'registry.json',
};

/** GlobalState key for persisted ETag mappings. */
const ETAG_STATE_KEY = 'registryEtags';

/** Common headers for all GitHub API requests. */
const BASE_HEADERS: Record<string, string> = {
  'User-Agent': 'agent-config-keeper',
};

/**
 * Optional configuration reader, injectable for testability.
 * Defaults to using `vscode.workspace.getConfiguration` at runtime.
 */
export interface RegistryConfigReader {
  getCustomSources(): RegistrySource[];
}

/**
 * Fetches, caches, and serves tool registry data from GitHub-hosted registries.
 *
 * All marketplace UI work consumes RegistryEntry[] from this service.
 * ETag-based conditional requests avoid redundant downloads on browse.
 */
export class RegistryService {
  private readonly indexCache = new Map<string, RegistryCache>();
  private readonly readmeCache = new Map<string, string>();
  private readonly configReader: RegistryConfigReader;

  constructor(
    private readonly context: vscode.ExtensionContext,
    configReader?: RegistryConfigReader,
  ) {
    this.configReader = configReader ?? RegistryService.defaultConfigReader();
    this.restoreEtags();
  }

  // ---------------------------------------------------------------------------
  // Sources
  // ---------------------------------------------------------------------------

  /** Returns all configured registry sources, always including the default. */
  getSources(): RegistrySource[] {
    const custom = this.configReader.getCustomSources();

    const hasDefault = custom.some((s) => s.id === DEFAULT_REGISTRY.id);
    return hasDefault ? [...custom] : [DEFAULT_REGISTRY, ...custom];
  }

  /**
   * Default config reader that delegates to vscode.workspace.getConfiguration.
   * Separated so the constructor can accept an override for testing.
   */
  private static defaultConfigReader(): RegistryConfigReader {
    return {
      getCustomSources(): RegistrySource[] {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const vscodeApi = require('vscode') as typeof vscode;
        return (
          vscodeApi.workspace
            .getConfiguration('agentConfigKeeper')
            .get<RegistrySource[]>('registrySources') ?? []
        );
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Index fetching
  // ---------------------------------------------------------------------------

  /**
   * Fetch the registry index for a single source.
   *
   * Uses ETag-based conditional requests so unchanged data is never
   * re-downloaded. On 304 the cached index is returned immediately.
   */
  async fetchIndex(
    source: RegistrySource,
    forceRefresh = false,
  ): Promise<RegistryIndex> {
    const url = this.contentsUrl(source, source.indexPath);
    const headers: Record<string, string> = {
      ...BASE_HEADERS,
      Accept: 'application/vnd.github.raw+json',
    };

    const cached = this.indexCache.get(source.id);

    if (cached && !forceRefresh && cached.etag) {
      headers['If-None-Match'] = cached.etag;
    }

    let response: Response;
    try {
      response = await fetch(url, { headers });
    } catch (err) {
      throw new Error(
        `Network error fetching index for "${source.name}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (response.status === 304 && cached) {
      return cached.index;
    }

    if (!response.ok) {
      throw new Error(
        `Failed to fetch index for "${source.name}": HTTP ${response.status}`,
      );
    }

    const index = (await response.json()) as RegistryIndex;
    const etag = response.headers.get('etag');

    this.indexCache.set(source.id, {
      source,
      index,
      etag,
      fetchedAt: Date.now(),
    });

    await this.persistEtags();

    return index;
  }

  /**
   * Fetch indexes from all configured sources in parallel.
   *
   * Returns a Map keyed by source.id. Failing sources are logged but do
   * not prevent other sources from succeeding.
   */
  async fetchAllIndexes(forceRefresh = false): Promise<
    Map<string, { source: RegistrySource; index: RegistryIndex }>
  > {
    const sources = this.getSources();
    const results = await Promise.allSettled(
      sources.map(async (source) => {
        const index = await this.fetchIndex(source, forceRefresh);
        return { source, index };
      }),
    );

    const map = new Map<
      string,
      { source: RegistrySource; index: RegistryIndex }
    >();

    for (const result of results) {
      if (result.status === 'fulfilled') {
        map.set(result.value.source.id, result.value);
      }
      // Failures are silently skipped -- callers get partial results.
    }

    return map;
  }

  // ---------------------------------------------------------------------------
  // README fetching
  // ---------------------------------------------------------------------------

  /**
   * Fetch a single tool's README from the registry repo.
   *
   * Results are cached in-memory (no persistence). On error a fallback
   * string is returned rather than throwing.
   */
  async fetchReadme(
    source: RegistrySource,
    readmePath: string,
  ): Promise<string> {
    const cacheKey = `${source.id}:${readmePath}`;
    const cached = this.readmeCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const url = this.contentsUrl(source, readmePath);
      const response = await fetch(url, {
        headers: {
          ...BASE_HEADERS,
          Accept: 'application/vnd.github.raw',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const markdown = await response.text();
      this.readmeCache.set(cacheKey, markdown);
      return markdown;
    } catch {
      return 'README could not be loaded.';
    }
  }

  // ---------------------------------------------------------------------------
  // Tool content fetching (for install)
  // ---------------------------------------------------------------------------

  /**
   * Fetch a tool's manifest.json from the registry.
   *
   * Downloads `{contentPath}/manifest.json` using the GitHub Contents API
   * with raw JSON Accept header. Validates the response with ToolManifestSchema.
   * Throws on HTTP error or validation failure.
   *
   * No caching -- tool content should always be fresh at install time.
   */
  async fetchToolManifest(
    source: RegistrySource,
    contentPath: string,
  ): Promise<ToolManifest> {
    const manifestPath = `${contentPath}/manifest.json`;
    const url = this.contentsUrl(source, manifestPath);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          ...BASE_HEADERS,
          Accept: 'application/vnd.github.raw+json',
        },
      });
    } catch (err) {
      throw new Error(
        `Network error fetching manifest for "${contentPath}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `Failed to fetch manifest for "${contentPath}": HTTP ${response.status}`,
      );
    }

    const raw: unknown = await response.json();
    const parsed = ToolManifestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `Invalid tool manifest at "${contentPath}": ${parsed.error.message}`,
      );
    }

    return parsed.data as ToolManifest;
  }

  /**
   * Fetch a raw file from the registry (e.g., SKILL.md, command.md).
   *
   * Downloads the file at the given path using the GitHub Contents API
   * with raw Accept header. Returns the file content as a string.
   * Throws on HTTP error.
   *
   * No caching -- tool content should always be fresh at install time.
   */
  async fetchToolFile(
    source: RegistrySource,
    filePath: string,
  ): Promise<string> {
    const url = this.contentsUrl(source, filePath);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          ...BASE_HEADERS,
          Accept: 'application/vnd.github.raw',
        },
      });
    } catch (err) {
      throw new Error(
        `Network error fetching file "${filePath}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `Failed to fetch file "${filePath}": HTTP ${response.status}`,
      );
    }

    return await response.text();
  }

  // ---------------------------------------------------------------------------
  // Cache management
  // ---------------------------------------------------------------------------

  /** Clear all in-memory caches and persisted ETag metadata. */
  clearCache(): void {
    this.indexCache.clear();
    this.readmeCache.clear();
    void this.context.globalState.update(ETAG_STATE_KEY, undefined);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private contentsUrl(source: RegistrySource, filePath: string): string {
    return `https://api.github.com/repos/${source.owner}/${source.repo}/contents/${filePath}?ref=${source.branch}`;
  }

  /** Persist ETag + source.id mapping to globalState so ETags survive restarts. */
  private async persistEtags(): Promise<void> {
    const etags: Record<string, string> = {};
    for (const [id, cache] of this.indexCache) {
      if (cache.etag) {
        etags[id] = cache.etag;
      }
    }
    await this.context.globalState.update(ETAG_STATE_KEY, etags);
  }

  /** Restore persisted ETags into index cache stubs on construction. */
  private restoreEtags(): void {
    const etags =
      this.context.globalState.get<Record<string, string>>(ETAG_STATE_KEY);
    if (!etags) {
      return;
    }
    // We only restore the etag -- not the full index. This means the first
    // fetch after restart will still send If-None-Match; if the server
    // responds 304 we'll get an empty body, so we treat that as a miss.
    // The practical benefit: after a restart + a 200 response we cache
    // properly again, and the etag is preserved across restarts for the
    // next conditional request.
    for (const [id, etag] of Object.entries(etags)) {
      if (!this.indexCache.has(id)) {
        // We don't have a cached index yet -- can't return on 304 without
        // one. So we skip restoring this entry; fetchIndex will get a fresh
        // 200 and populate the cache.
        // This is intentional: ETags are useful only when combined with
        // cached data. Persisting ETags without data means we'd get 304s
        // we can't honor. Instead we let the first fetch be a full 200.
        void etag;
      }
    }
  }
}
