/**
 * Parser for Pi custom prompts.
 *
 * Custom prompts are single .md files (not directories like skills).
 * The filename (minus .md) becomes the slash command name.
 * Frontmatter is optional and may contain 'description' and 'argument-hint'.
 */
import type { FileIOService } from '../../../services/fileio.service.js';
import type { NormalizedTool } from '../../../types/config.js';
import { ToolType, ConfigScope, ToolStatus } from '../../../types/enums.js';
import { parseMarkdownToolDir } from '../../shared/markdown-tool-dir.js';

/**
 * Parse all custom prompts from a prompts directory.
 *
 * Returns empty array if directory does not exist.
 * Each .md file becomes a NormalizedTool with type CustomPrompt.
 */
export async function parsePiPromptsDir(
  fileIO: FileIOService,
  promptsDir: string,
  scope: ConfigScope,
): Promise<NormalizedTool[]> {
  return parseMarkdownToolDir(fileIO, promptsDir, '.md', ({ baseName, fm, filePath, content }) => ({
    id: `prompt:pi:${scope}:${baseName}`,
    type: ToolType.CustomPrompt,
    name: baseName, // Filename becomes the slash command name
    description: fm?.frontmatter['description'],
    scope,
    status: ToolStatus.Enabled, // No disable semantics for custom prompts
    source: { filePath, isDirectory: false },
    metadata: {
      argumentHint: fm?.frontmatter['argument-hint'],
      body: fm?.body ?? content,
    },
  }));
}
