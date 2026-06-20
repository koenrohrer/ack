/**
 * Parser for GitHub Copilot reusable prompt files.
 *
 * Reads all `.prompt.md` files from `.github/prompts/`.
 * Each file becomes a NormalizedTool with type CustomPrompt and scope Project.
 *
 * Note: The `tools` array in prompt frontmatter (YAML array syntax) is NOT
 * parseable by extractFrontmatter() which handles flat key:value pairs only.
 * This is acceptable for Phase 22 — do not attempt to parse it.
 */
import type { FileIOService } from '../../../services/fileio.service.js';
import type { NormalizedTool } from '../../../types/config.js';
import { ToolType, ConfigScope, ToolStatus } from '../../../types/enums.js';
import { parseMarkdownToolDir } from '../../shared/markdown-tool-dir.js';
import { CopilotPaths } from '../paths.js';

/**
 * Parse all Copilot reusable prompt files from a workspace.
 *
 * Returns an empty array if the prompts directory does not exist or is empty.
 * Results are sorted alphabetically by name.
 */
export async function parseCopilotPrompts(
  fileIO: FileIOService,
  workspaceRoot: string,
): Promise<NormalizedTool[]> {
  const promptsDir = CopilotPaths.workspacePromptsDir(workspaceRoot);

  return parseMarkdownToolDir(fileIO, promptsDir, '.prompt.md', ({ baseName, fm, filePath, content }) => ({
    id: `prompt:project:${baseName}`,
    type: ToolType.CustomPrompt,
    scope: ConfigScope.Project,
    status: ToolStatus.Enabled,
    name: baseName,
    description: fm?.frontmatter['description'],
    source: { filePath, isDirectory: false },
    metadata: {
      instructionKind: 'prompt',
      // Copilot uses both 'mode' and 'agent' field names; prefer 'mode'
      mode: fm?.frontmatter['mode'] ?? fm?.frontmatter['agent'],
      body: fm?.body ?? content,
    },
  }));
}
