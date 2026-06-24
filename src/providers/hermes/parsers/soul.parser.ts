import type { FileIOService } from '../../../services/fileio.service.js';
import type { NormalizedTool } from '../../../types/config.js';
import { ToolType, ConfigScope, ToolStatus } from '../../../types/enums.js';

/**
 * Parse the Hermes SOUL.md file into a single CustomPrompt NormalizedTool.
 *
 * SOUL.md is Hermes's durable system-prompt slot -- the agent's identity /
 * persistent instructions that are always in context (not a per-invocation
 * slash command like Codex prompts). It is a single markdown file, so there
 * is exactly one tool (or none, when the file is absent).
 *
 * Returns an empty array if SOUL.md does not exist.
 */
export async function parseHermesSoul(
  fileIO: FileIOService,
  soulPath: string,
  scope: ConfigScope,
): Promise<NormalizedTool[]> {
  const content = await fileIO.readTextFile(soulPath);
  if (content === null) {
    return [];
  }

  return [
    {
      id: `prompt:hermes:${scope}:SOUL`,
      type: ToolType.CustomPrompt,
      name: 'SOUL',
      description: 'Agent identity / system prompt (SOUL.md)',
      scope,
      status: ToolStatus.Enabled,
      source: { filePath: soulPath, isDirectory: false },
      metadata: { body: content },
    },
  ];
}
