import * as path from 'path';
import * as fs from 'fs/promises';
import type { FileIOService } from '../../../services/fileio.service.js';
import type { SchemaService } from '../../../services/schema.service.js';
import { ToolType, ConfigScope, ToolStatus } from '../../../types/enums.js';
import type { NormalizedTool } from '../../../types/config.js';
import { extractFrontmatter } from '../../../utils/markdown.js';

/**
 * Parse a single slash command .md file and return a NormalizedTool.
 *
 * The command name is derived from the filename (without .md extension).
 * Frontmatter is optional -- commands work without it.
 */
export async function parseCommandFile(
  fileIO: FileIOService,
  schemaService: SchemaService,
  filePath: string,
  scope: ConfigScope,
): Promise<NormalizedTool> {
  const commandName = path.basename(filePath, '.md');
  const content = await fileIO.readTextFile(filePath);

  if (content === null) {
    return {
      id: `command:${scope}:${commandName}`,
      type: ToolType.Command,
      name: commandName,
      scope,
      status: ToolStatus.Error,
      statusDetail: 'File not readable',
      source: { filePath },
      metadata: {},
    };
  }

  const frontmatterResult = extractFrontmatter(content);

  if (!frontmatterResult) {
    // Commands without frontmatter are valid
    return {
      id: `command:${scope}:${commandName}`,
      type: ToolType.Command,
      name: commandName,
      scope,
      status: ToolStatus.Enabled,
      source: { filePath },
      metadata: { body: content },
    };
  }

  const validation = schemaService.validate('command-frontmatter', frontmatterResult.frontmatter);

  // Even if frontmatter validation fails, the command is still usable
  const data = validation.success
    ? (validation.data as {
        description?: string;
        'argument-hint'?: string;
        model?: string;
        'allowed-tools'?: string;
      })
    : frontmatterResult.frontmatter;

  return {
    id: `command:${scope}:${commandName}`,
    type: ToolType.Command,
    name: commandName,
    description: data?.description ?? data?.['description'],
    scope,
    status: ToolStatus.Enabled,
    source: { filePath },
    metadata: {
      argumentHint: data?.['argument-hint'],
      model: data?.model,
      allowedTools: data?.['allowed-tools'],
      body: frontmatterResult.body,
    },
  };
}

/**
 * Recursively find all .md files in a commands directory and parse each one.
 *
 * Subdirectories are supported for organization (per Claude Code docs).
 * Returns empty array if the directory does not exist.
 */
export async function parseCommandsDir(
  fileIO: FileIOService,
  schemaService: SchemaService,
  commandsDir: string,
  scope: ConfigScope,
): Promise<NormalizedTool[]> {
  const exists = await fileIO.fileExists(commandsDir);
  if (!exists) {
    return [];
  }

  const mdFiles = await findMdFiles(commandsDir);
  const tools: NormalizedTool[] = [];

  for (const mdFile of mdFiles) {
    const tool = await parseCommandFile(fileIO, schemaService, mdFile, scope);
    tools.push(tool);
  }

  return tools;
}

/**
 * Recursively find all .md files under a directory.
 */
async function findMdFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findMdFiles(fullPath);
      results.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }

  return results;
}
