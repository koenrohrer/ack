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
import * as path from 'path';
import type { FileIOService } from '../../../services/fileio.service.js';
import type { NormalizedTool } from '../../../types/config.js';
import { ToolType, ConfigScope, ToolStatus } from '../../../types/enums.js';
import { extractFrontmatter } from '../../../utils/markdown.js';
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
  const filenames = await fileIO.listFiles(promptsDir, '.prompt.md');

  const tools: NormalizedTool[] = [];

  for (const filename of filenames) {
    const filePath = path.join(promptsDir, filename);
    const content = await fileIO.readTextFile(filePath);
    if (content === null) {
      continue;
    }

    const baseName = path.basename(filename, '.prompt.md');
    const fm = extractFrontmatter(content);
    const description = fm?.frontmatter['description'];
    // Copilot uses both 'mode' and 'agent' field names; prefer 'mode'
    const mode = fm?.frontmatter['mode'] ?? fm?.frontmatter['agent'];

    tools.push({
      id: `prompt:project:${baseName}`,
      type: ToolType.CustomPrompt,
      scope: ConfigScope.Project,
      status: ToolStatus.Enabled,
      name: baseName,
      description,
      source: { filePath, isDirectory: false },
      metadata: {
        instructionKind: 'prompt',
        mode,
        body: fm?.body ?? content,
      },
    });
  }

  // Sort alphabetically by name
  tools.sort((a, b) => a.name.localeCompare(b.name));

  return tools;
}
