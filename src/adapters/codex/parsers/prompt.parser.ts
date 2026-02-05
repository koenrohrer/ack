/**
 * Parser for Codex custom prompts.
 *
 * Custom prompts are single .md files (not directories like skills).
 * The filename (minus .md) becomes the slash command name.
 * Frontmatter is optional and may contain 'description' and 'argument-hint'.
 */
import * as path from 'path';
import type { FileIOService } from '../../../services/fileio.service.js';
import type { NormalizedTool } from '../../../types/config.js';
import { ToolType, ConfigScope, ToolStatus } from '../../../types/enums.js';
import { extractFrontmatter } from '../../../utils/markdown.js';

/**
 * Parse all custom prompts from a prompts directory.
 *
 * Returns empty array if directory does not exist.
 * Each .md file becomes a NormalizedTool with type CustomPrompt.
 */
export async function parsePromptsDir(
  fileIO: FileIOService,
  promptsDir: string,
  scope: ConfigScope,
): Promise<NormalizedTool[]> {
  const files = await fileIO.listFiles(promptsDir, '.md');

  const tools: NormalizedTool[] = [];
  for (const filename of files) {
    const filePath = path.join(promptsDir, filename);
    const tool = await parsePromptFile(fileIO, filePath, scope);
    if (tool) {
      tools.push(tool);
    }
  }

  // Sort alphabetically by name (per CONTEXT.md: Claude's discretion, recommend alphabetical)
  tools.sort((a, b) => a.name.localeCompare(b.name));

  return tools;
}

/**
 * Parse a single custom prompt .md file.
 */
async function parsePromptFile(
  fileIO: FileIOService,
  filePath: string,
  scope: ConfigScope,
): Promise<NormalizedTool | null> {
  const content = await fileIO.readTextFile(filePath);
  if (content === null) {
    return null;
  }

  const filename = path.basename(filePath, '.md');

  // Frontmatter is optional for prompts
  const frontmatter = extractFrontmatter(content);
  const description = frontmatter?.frontmatter['description'];
  const argumentHint = frontmatter?.frontmatter['argument-hint'];

  return {
    id: `prompt:codex:${scope}:${filename}`,
    type: ToolType.CustomPrompt,
    name: filename, // Filename becomes the slash command name
    description,
    scope,
    status: ToolStatus.Enabled, // No disable semantics per CONTEXT.md
    source: { filePath, isDirectory: false },
    metadata: {
      argumentHint,
      body: frontmatter?.body ?? content,
    },
  };
}
