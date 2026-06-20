import { describe, expect, it } from 'vitest';
import { parseMarkdownToolDir } from '../../providers/shared/markdown-tool-dir.js';
import type { FileIOService } from '../../services/fileio.service.js';
import { ToolType, ConfigScope, ToolStatus } from '../../types/enums.js';

/**
 * Minimal FileIOService stub backed by an in-memory file map.
 * Only listFiles + readTextFile are exercised by parseMarkdownToolDir.
 */
function makeFileIO(files: Record<string, string | null>): FileIOService {
  return {
    listFiles: async (_dir: string, extension?: string) =>
      Object.keys(files).filter((name) => !extension || name.endsWith(extension)),
    readTextFile: async (filePath: string) => {
      const name = filePath.split('/').pop()!;
      return name in files ? files[name] : null;
    },
  } as unknown as FileIOService;
}

describe('parseMarkdownToolDir', () => {
  it('lists by extension, extracts frontmatter, and maps each file', async () => {
    const fileIO = makeFileIO({
      'beta.md': '---\ndescription: Bee\n---\nbody-b',
      'alpha.md': 'no frontmatter here',
      'skip.txt': 'ignored by extension filter',
    });

    const tools = await parseMarkdownToolDir(fileIO, '/dir', '.md', ({ baseName, fm, filePath, content }) => ({
      id: `t:${baseName}`,
      type: ToolType.CustomPrompt,
      name: baseName,
      description: fm?.frontmatter['description'],
      scope: ConfigScope.Project,
      status: ToolStatus.Enabled,
      source: { filePath, isDirectory: false },
      metadata: { body: fm?.body ?? content },
    }));

    // Sorted alphabetically by name: alpha before beta
    expect(tools).toEqual([
      {
        id: 't:alpha',
        type: ToolType.CustomPrompt,
        name: 'alpha',
        description: undefined,
        scope: ConfigScope.Project,
        status: ToolStatus.Enabled,
        source: { filePath: '/dir/alpha.md', isDirectory: false },
        metadata: { body: 'no frontmatter here' },
      },
      {
        id: 't:beta',
        type: ToolType.CustomPrompt,
        name: 'beta',
        description: 'Bee',
        scope: ConfigScope.Project,
        status: ToolStatus.Enabled,
        source: { filePath: '/dir/beta.md', isDirectory: false },
        metadata: { body: 'body-b' },
      },
    ]);
  });

  it('strips a multi-part extension to derive baseName', async () => {
    const fileIO = makeFileIO({ 'foo.agent.md': 'hello' });

    const tools = await parseMarkdownToolDir(fileIO, '/dir', '.agent.md', ({ baseName }) => ({
      id: baseName,
      type: ToolType.Skill,
      name: baseName,
      scope: ConfigScope.Project,
      status: ToolStatus.Enabled,
      source: { filePath: '/x' },
      metadata: {},
    }));

    expect(tools[0].name).toBe('foo');
  });

  it('skips unreadable files (content null)', async () => {
    const fileIO = makeFileIO({ 'ok.md': 'content', 'gone.md': null });

    const tools = await parseMarkdownToolDir(fileIO, '/dir', '.md', ({ baseName }) => ({
      id: baseName,
      type: ToolType.CustomPrompt,
      name: baseName,
      scope: ConfigScope.Project,
      status: ToolStatus.Enabled,
      source: { filePath: '/x' },
      metadata: {},
    }));

    expect(tools.map((t) => t.name)).toEqual(['ok']);
  });

  it('skips files for which the map callback returns null', async () => {
    const fileIO = makeFileIO({ 'keep.md': 'a', 'drop.md': 'b' });

    const tools = await parseMarkdownToolDir(fileIO, '/dir', '.md', ({ baseName }) =>
      baseName === 'drop'
        ? null
        : {
            id: baseName,
            type: ToolType.CustomPrompt,
            name: baseName,
            scope: ConfigScope.Project,
            status: ToolStatus.Enabled,
            source: { filePath: '/x' },
            metadata: {},
          },
    );

    expect(tools.map((t) => t.name)).toEqual(['keep']);
  });

  it('returns an empty array when the directory has no matching files', async () => {
    const fileIO = makeFileIO({});

    const tools = await parseMarkdownToolDir(fileIO, '/dir', '.md', () => {
      throw new Error('map should not be called');
    });

    expect(tools).toEqual([]);
  });
});
