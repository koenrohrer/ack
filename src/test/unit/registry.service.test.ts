import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { RegistryIndex, RegistrySource } from '../../services/registry.types.js';
import type { RegistryConfigReader } from '../../services/registry.service.js';
import type * as vscode from 'vscode';
import { RegistryService } from '../../services/registry.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COMMUNITY_SOURCE: RegistrySource = {
  id: 'community',
  name: 'Community Registry',
  owner: 'koenrohrer',
  repo: 'tool-registry',
  branch: 'main',
  indexPath: 'registry.json',
};

const CUSTOM_SOURCE: RegistrySource = {
  id: 'custom',
  name: 'My Registry',
  owner: 'my-org',
  repo: 'my-registry',
  branch: 'main',
  indexPath: 'index.json',
};

function makeIndex(overrides: Partial<RegistryIndex> = {}): RegistryIndex {
  return {
    version: 1,
    lastUpdated: '2026-01-01T00:00:00Z',
    tools: [
      {
        id: 'claude-memory-skill',
        name: 'Memory Skill',
        type: 'skill',
        description: 'Adds memory to Claude',
        author: 'community',
        version: '1.0.0',
        tags: ['memory'],
        stars: 42,
        installs: 100,
        readmePath: 'tools/memory/README.md',
        contentPath: 'tools/memory',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
    ...overrides,
  };
}

function makeGlobalState(): vscode.Memento & { setKeysForSync?(keys: readonly string[]): void } {
  const store = new Map<string, unknown>();
  return {
    keys: () => [...store.keys()],
    get<T>(key: string, defaultValue?: T): T {
      return (store.has(key) ? store.get(key) : defaultValue) as T;
    },
    async update(key: string, value: unknown): Promise<void> {
      if (value === undefined) {
        store.delete(key);
      } else {
        store.set(key, value);
      }
    },
  };
}

function makeContext(): vscode.ExtensionContext {
  return {
    globalState: makeGlobalState(),
  } as unknown as vscode.ExtensionContext;
}

function makeConfigReader(customSources: RegistrySource[] = []): RegistryConfigReader {
  return {
    getCustomSources: () => customSources,
  };
}

function mockFetchResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const headersObj = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headersObj,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RegistryService', () => {
  let service: RegistryService;
  let ctx: vscode.ExtensionContext;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ctx = makeContext();
    service = new RegistryService(ctx, makeConfigReader());

    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // fetchIndex
  // -------------------------------------------------------------------------

  it('fetchIndex returns parsed RegistryIndex on 200', async () => {
    const index = makeIndex();
    fetchSpy.mockResolvedValue(
      mockFetchResponse(200, index, { etag: '"abc123"' }),
    );

    const result = await service.fetchIndex(COMMUNITY_SOURCE);

    expect(result.version).toBe(1);
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].id).toBe('claude-memory-skill');
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('fetchIndex sends If-None-Match on second call', async () => {
    const index = makeIndex();

    // First call: 200 with ETag
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(200, index, { etag: '"abc123"' }),
    );

    // Second call: 304 (not modified)
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(304, null),
    );

    await service.fetchIndex(COMMUNITY_SOURCE);
    const result = await service.fetchIndex(COMMUNITY_SOURCE);

    // Second fetch should have If-None-Match header
    const secondCallHeaders = fetchSpy.mock.calls[1][1].headers;
    expect(secondCallHeaders['If-None-Match']).toBe('"abc123"');

    // Should return the cached data
    expect(result.version).toBe(1);
    expect(result.tools).toHaveLength(1);
  });

  it('fetchIndex uses cache on 304 response', async () => {
    const index = makeIndex();

    // Populate cache via a 200
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(200, index, { etag: '"etag-1"' }),
    );
    await service.fetchIndex(COMMUNITY_SOURCE);

    // Now mock a 304
    const response304 = mockFetchResponse(304, null);
    fetchSpy.mockResolvedValueOnce(response304);

    const result = await service.fetchIndex(COMMUNITY_SOURCE);

    // Returned cached data without parsing
    expect(result).toEqual(index);
    // The 304 response's json() should NOT have been called
    expect(response304.json).not.toHaveBeenCalled();
  });

  it('fetchIndex throws on network error', async () => {
    fetchSpy.mockRejectedValue(new Error('ENOTFOUND'));

    await expect(service.fetchIndex(COMMUNITY_SOURCE)).rejects.toThrow(
      /Network error fetching index for "Community Registry".*ENOTFOUND/,
    );
  });

  it('fetchIndex throws on 404', async () => {
    fetchSpy.mockResolvedValue(mockFetchResponse(404, 'Not Found'));

    await expect(service.fetchIndex(COMMUNITY_SOURCE)).rejects.toThrow(
      /Failed to fetch index for "Community Registry": HTTP 404/,
    );
  });

  // -------------------------------------------------------------------------
  // fetchAllIndexes
  // -------------------------------------------------------------------------

  it('fetchAllIndexes returns partial results on mixed success/failure', async () => {
    // Create service with two sources
    service = new RegistryService(ctx, makeConfigReader([CUSTOM_SOURCE]));

    const communityIndex = makeIndex();
    const communityUrl =
      'https://api.github.com/repos/koenrohrer/tool-registry/contents/registry.json?ref=main';
    const customUrl =
      'https://api.github.com/repos/my-org/my-registry/contents/index.json?ref=main';

    fetchSpy.mockImplementation(async (url: string) => {
      if (url === communityUrl) {
        return mockFetchResponse(200, communityIndex, { etag: '"c1"' });
      }
      if (url === customUrl) {
        throw new Error('ECONNREFUSED');
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const results = await service.fetchAllIndexes();

    // Only community should succeed
    expect(results.size).toBe(1);
    expect(results.has('community')).toBe(true);
    expect(results.has('custom')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // fetchReadme
  // -------------------------------------------------------------------------

  it('fetchReadme returns markdown string', async () => {
    const markdown = '# Memory Skill\n\nThis skill adds memory.';
    fetchSpy.mockResolvedValue(mockFetchResponse(200, markdown));

    const result = await service.fetchReadme(
      COMMUNITY_SOURCE,
      'tools/memory/README.md',
    );

    expect(result).toBe(markdown);
  });

  it('fetchReadme returns fallback on error', async () => {
    fetchSpy.mockRejectedValue(new Error('Network failure'));

    const result = await service.fetchReadme(
      COMMUNITY_SOURCE,
      'tools/memory/README.md',
    );

    expect(result).toBe('README could not be loaded.');
  });

  // -------------------------------------------------------------------------
  // getSources
  // -------------------------------------------------------------------------

  it('getSources returns default when no config', () => {
    service = new RegistryService(ctx, makeConfigReader());

    const sources = service.getSources();

    expect(sources).toHaveLength(1);
    expect(sources[0].id).toBe('community');
    expect(sources[0].name).toBe('Community Registry');
  });

  // -------------------------------------------------------------------------
  // clearCache
  // -------------------------------------------------------------------------

  it('clearCache empties in-memory and globalState', async () => {
    const index = makeIndex();

    // Populate cache
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(200, index, { etag: '"clear-test"' }),
    );
    await service.fetchIndex(COMMUNITY_SOURCE);

    // Verify cache was populated
    expect(ctx.globalState.get('registryEtags')).toBeDefined();

    // Clear it
    service.clearCache();

    // globalState should be cleared immediately
    // (use a microtask tick to allow the void promise to settle)
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.globalState.get('registryEtags')).toBeUndefined();

    // Next fetch should NOT send If-None-Match (cache was cleared)
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(200, index, { etag: '"new-etag"' }),
    );
    await service.fetchIndex(COMMUNITY_SOURCE);

    const secondCallHeaders = fetchSpy.mock.calls[1][1].headers;
    expect(secondCallHeaders['If-None-Match']).toBeUndefined();
  });
});
