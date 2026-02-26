/**
 * Parser for GitHub Copilot agent definition files.
 *
 * Reads all `*.agent.md` files in `.github/agents/` and returns them as
 * NormalizedTool[] with type Skill and scope Project.
 *
 * The `user-invokable` frontmatter field controls enabled/disabled status:
 * - absent or any value other than 'false' → ToolStatus.Enabled
 * - 'false' (string) → ToolStatus.Disabled
 *
 * Results are sorted alphabetically by name.
 */
import * as path from 'path';
import type { FileIOService } from '../../../services/fileio.service.js';
import type { NormalizedTool } from '../../../types/config.js';
import { ToolType, ConfigScope, ToolStatus } from '../../../types/enums.js';
import { extractFrontmatter } from '../../../utils/markdown.js';
import { CopilotPaths } from '../paths.js';

/**
 * Parse all Copilot agent definition files from a workspace.
 *
 * Reads `*.agent.md` files from `.github/agents/`. Returns an empty array
 * if the directory does not exist or contains no matching files — never
 * throws for missing directories or files.
 *
 * Note: `user-invokable` is a YAML string, not a boolean. Only the exact
 * string `'false'` disables the agent; all other values (including absent)
 * result in Enabled status.
 */
export async function parseCopilotAgents(
  fileIO: FileIOService,
  workspaceRoot: string,
): Promise<NormalizedTool[]> {
  const agentsDir = CopilotPaths.workspaceAgentsDir(workspaceRoot);
  const filenames = await fileIO.listFiles(agentsDir, '.agent.md');

  const tools: NormalizedTool[] = [];

  for (const filename of filenames) {
    const filePath = path.join(agentsDir, filename);
    const content = await fileIO.readTextFile(filePath);
    if (content === null) {
      continue;
    }

    const baseName = path.basename(filename, '.agent.md');
    const fm = extractFrontmatter(content);

    // String comparison — extractFrontmatter returns strings, NOT booleans
    const status =
      fm?.frontmatter['user-invokable'] === 'false'
        ? ToolStatus.Disabled
        : ToolStatus.Enabled;

    tools.push({
      id: `skill:project:${baseName}`,
      type: ToolType.Skill,
      scope: ConfigScope.Project,
      status,
      name: fm?.frontmatter['name'] ?? baseName,
      description: fm?.frontmatter['description'],
      source: { filePath, isDirectory: false },
      metadata: {
        agentFilename: baseName,
        userInvokable: status === ToolStatus.Enabled,
        body: fm?.body ?? content,
      },
    });
  }

  // Sort alphabetically by name
  tools.sort((a, b) => a.name.localeCompare(b.name));

  return tools;
}
