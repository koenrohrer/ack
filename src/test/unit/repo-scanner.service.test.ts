import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepoScannerService } from '../../services/repo-scanner.service.js';

function mockFetchResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('RepoScannerService', () => {
  it('discovers Copilot prompt files as installable custom prompts', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          full_name: 'owner/prompts',
          html_url: 'https://github.com/owner/prompts',
          default_branch: 'main',
          description: 'Prompt collection',
          owner: { login: 'owner' },
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          tree: [
            { path: '.github/prompts/review.prompt.md', type: 'blob' },
          ],
          truncated: false,
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse(200, '---\ndescription: Review changed files\n---\n# Review\n'),
      );
    vi.stubGlobal('fetch', fetchSpy);

    const result = await new RepoScannerService().scanRepo('owner/prompts');

    expect(result.tools).toEqual([
      expect.objectContaining({
        id: 'repo:owner/prompts:custom_prompt:review',
        name: 'review',
        toolType: 'custom_prompt',
        description: 'Review changed files',
        repoPath: '.github/prompts/review.prompt.md',
        files: ['.github/prompts/review.prompt.md'],
      }),
    ]);
  });

  it('does not surface case-variant prompt suffixes that cannot be installed', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          full_name: 'owner/prompts',
          html_url: 'https://github.com/owner/prompts',
          default_branch: 'main',
          description: 'Prompt collection',
          owner: { login: 'owner' },
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          tree: [
            { path: '.github/prompts/review.PROMPT.MD', type: 'blob' },
          ],
          truncated: false,
        }),
      );
    vi.stubGlobal('fetch', fetchSpy);

    const result = await new RepoScannerService().scanRepo('owner/prompts');

    expect(result.tools).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
