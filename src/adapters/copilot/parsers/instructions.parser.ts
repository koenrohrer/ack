/**
 * Parser for GitHub Copilot instruction files.
 *
 * Reads two kinds of Copilot instruction files:
 * 1. The single always-on global file at `.github/copilot-instructions.md`
 * 2. All `*.instructions.md` files in `.github/instructions/`
 *
 * Returns NormalizedTool[] with type CustomPrompt and scope Project.
 * Results are sorted alphabetically by name.
 */
import * as path from 'path';
import type { FileIOService } from '../../../services/fileio.service.js';
import type { NormalizedTool } from '../../../types/config.js';
import { ToolType, ConfigScope, ToolStatus } from '../../../types/enums.js';
import { extractFrontmatter } from '../../../utils/markdown.js';
import { CopilotPaths } from '../paths.js';

/**
 * Parse all Copilot instruction files from a workspace.
 *
 * Includes the global `copilot-instructions.md` (if it exists) and all
 * `.instructions.md` files in the instructions directory. Returns an empty
 * array if no files exist — never throws for missing directories or files.
 */
export async function parseCopilotInstructions(
  fileIO: FileIOService,
  workspaceRoot: string,
): Promise<NormalizedTool[]> {
  const tools: NormalizedTool[] = [];

  // --- Global always-on instructions file ---

  const globalPath = CopilotPaths.workspaceCopilotInstructionsFile(workspaceRoot);
  const globalContent = await fileIO.readTextFile(globalPath);

  if (globalContent !== null) {
    const fm = extractFrontmatter(globalContent);
    tools.push({
      id: 'instruction:project:copilot-instructions',
      type: ToolType.CustomPrompt,
      scope: ConfigScope.Project,
      status: ToolStatus.Enabled,
      name: 'copilot-instructions',
      description: 'Always-on Copilot instructions (applies to all chats)',
      source: { filePath: globalPath, isDirectory: false },
      metadata: {
        instructionKind: 'global',
        body: fm?.body ?? globalContent,
      },
    });
  }

  // --- Per-file instruction overrides (.instructions.md) ---

  const instructionsDir = CopilotPaths.workspaceInstructionsDir(workspaceRoot);
  const filenames = await fileIO.listFiles(instructionsDir, '.instructions.md');

  for (const filename of filenames) {
    const filePath = path.join(instructionsDir, filename);
    const content = await fileIO.readTextFile(filePath);
    if (content === null) {
      continue;
    }

    const baseName = path.basename(filename, '.instructions.md');
    const fm = extractFrontmatter(content);
    const applyTo = fm?.frontmatter['applyTo'];
    const description = fm?.frontmatter['description'];

    tools.push({
      id: `instruction:project:${baseName}`,
      type: ToolType.CustomPrompt,
      scope: ConfigScope.Project,
      status: ToolStatus.Enabled,
      name: baseName,
      description: description ?? (applyTo ? `Applies to: ${applyTo}` : undefined),
      source: { filePath: path.join(instructionsDir, filename), isDirectory: false },
      metadata: {
        instructionKind: 'file-pattern',
        applyTo,
        body: fm?.body ?? content,
      },
    });
  }

  // Sort alphabetically by name
  tools.sort((a, b) => a.name.localeCompare(b.name));

  return tools;
}
