import * as path from 'path';
import type { FileIOService } from '../../../services/fileio.service.js';
import type { SchemaService } from '../../../services/schema.service.js';
import { ToolType, ConfigScope, ToolStatus } from '../../../types/enums.js';
import type { NormalizedTool } from '../../../types/config.js';
import { extractFrontmatter } from '../../../utils/markdown.js';

/**
 * Parse a single skill directory and return a NormalizedTool.
 *
 * A skill directory must contain a SKILL.md file with YAML frontmatter.
 * Incomplete skill directories (missing SKILL.md) are returned with
 * Warning status rather than being silently skipped.
 */
export async function parseSkillDirectory(
  fileIO: FileIOService,
  schemaService: SchemaService,
  skillDir: string,
  scope: ConfigScope,
): Promise<NormalizedTool> {
  const dirName = path.basename(skillDir);
  const isDisabled = dirName.endsWith('.disabled');
  const cleanName = isDisabled ? dirName.replace(/\.disabled$/, '') : dirName;
  const skillMdPath = path.join(skillDir, 'SKILL.md');

  const content = await fileIO.readTextFile(skillMdPath);

  if (content === null) {
    return {
      id: `skill:${scope}:${cleanName}`,
      type: ToolType.Skill,
      name: cleanName,
      scope,
      status: ToolStatus.Warning,
      statusDetail: 'Missing SKILL.md',
      source: { filePath: skillMdPath, isDirectory: true, directoryPath: skillDir },
      metadata: {},
    };
  }

  const frontmatterResult = extractFrontmatter(content);

  if (!frontmatterResult) {
    return {
      id: `skill:${scope}:${cleanName}`,
      type: ToolType.Skill,
      name: cleanName,
      scope,
      status: ToolStatus.Warning,
      statusDetail: 'No frontmatter in SKILL.md',
      source: { filePath: skillMdPath, isDirectory: true, directoryPath: skillDir },
      metadata: { body: content },
    };
  }

  const validation = schemaService.validate('skill-frontmatter', frontmatterResult.frontmatter);

  if (!validation.success) {
    const message = validation.error.issues
      .map((i) => i.message)
      .join('; ');
    return {
      id: `skill:${scope}:${cleanName}`,
      type: ToolType.Skill,
      name: frontmatterResult.frontmatter['name'] ?? cleanName,
      scope,
      status: ToolStatus.Warning,
      statusDetail: `Invalid frontmatter: ${message}`,
      source: { filePath: skillMdPath, isDirectory: true, directoryPath: skillDir },
      metadata: { body: frontmatterResult.body },
    };
  }

  const data = validation.data as {
    name: string;
    description: string;
    'allowed-tools'?: string;
    model?: string;
  };

  return {
    id: `skill:${scope}:${data.name}`,
    type: ToolType.Skill,
    name: data.name,
    description: data.description,
    scope,
    status: isDisabled ? ToolStatus.Disabled : ToolStatus.Enabled,
    source: { filePath: skillMdPath, isDirectory: true, directoryPath: skillDir },
    metadata: {
      allowedTools: data['allowed-tools'],
      model: data.model,
      body: frontmatterResult.body,
    },
  };
}

/**
 * Parse all skill directories within a skills directory.
 *
 * Lists subdirectories, calls parseSkillDirectory for each.
 * Returns empty array if the skills directory does not exist.
 */
export async function parseSkillsDir(
  fileIO: FileIOService,
  schemaService: SchemaService,
  skillsDir: string,
  scope: ConfigScope,
): Promise<NormalizedTool[]> {
  const subdirs = await fileIO.listDirectories(skillsDir);

  const tools: NormalizedTool[] = [];

  for (const subdir of subdirs) {
    const skillDir = path.join(skillsDir, subdir);
    const tool = await parseSkillDirectory(fileIO, schemaService, skillDir, scope);
    tools.push(tool);
  }

  return tools;
}
