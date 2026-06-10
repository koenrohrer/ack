import * as path from 'path';
import type { FileIOService } from '../../services/fileio.service.js';
import type { NormalizedTool } from '../../types/config.js';
import { extractFrontmatter, type FrontmatterResult } from '../../utils/markdown.js';

/**
 * Per-file context handed to an adapter's `map` callback.
 *
 * `baseName` is the filename with its extension stripped; `fm` is the parsed
 * frontmatter (or null when the file has none); `filePath` is the absolute
 * path; `content` is the raw file text.
 */
export interface MarkdownToolFile {
  baseName: string;
  fm: FrontmatterResult | null;
  filePath: string;
  content: string;
}

/**
 * Walk a directory of markdown files and build NormalizedTool entries.
 *
 * Shared across adapter markdown-frontmatter parsers (Codex prompts, Copilot
 * agents/prompts/instructions). The common walk — list files by extension,
 * read each, skip unreadable ones, strip the extension, extract frontmatter,
 * and sort the results alphabetically by name — lives here. Each adapter
 * supplies a `map` callback that turns a {@link MarkdownToolFile} into the
 * NormalizedTool it wants (deciding id, type, name, status, and metadata),
 * mirroring how `extractMcpServers` takes a `map`.
 *
 * Files whose content is null (unreadable) are skipped, as is any file for
 * which `map` returns null.
 */
export async function parseMarkdownToolDir(
  fileIO: FileIOService,
  dir: string,
  extension: string,
  map: (file: MarkdownToolFile) => NormalizedTool | null,
): Promise<NormalizedTool[]> {
  const filenames = await fileIO.listFiles(dir, extension);

  const tools: NormalizedTool[] = [];

  for (const filename of filenames) {
    const filePath = path.join(dir, filename);
    const content = await fileIO.readTextFile(filePath);
    if (content === null) {
      continue;
    }

    const baseName = path.basename(filename, extension);
    const fm = extractFrontmatter(content);

    const tool = map({ baseName, fm, filePath, content });
    if (tool) {
      tools.push(tool);
    }
  }

  tools.sort((a, b) => a.name.localeCompare(b.name));

  return tools;
}
