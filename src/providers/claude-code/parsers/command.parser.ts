import * as path from 'path';
import * as fs from 'fs/promises';
import type { FileIOService } from '../../../services/fileio.service.js';
import type { SchemaService } from '../../../services/schema.service.js';
import { ToolType, ConfigScope, ToolStatus } from '../../../types/enums.js';
import type { NormalizedTool } from '../../../types/config.js';
import { extractFrontmatter } from '../../../utils/markdown.js';

/**
 * Suffix a disabled command file carries: toggling `deploy.md` off renames it
 * to `deploy.md.disabled`, which Claude Code no longer loads.
 */
const DISABLED_COMMAND_SUFFIX = '.md.disabled';

/** Whether a file name is a command file, enabled or disabled. */
function isCommandFileName(name: string): boolean {
  return name.endsWith('.md') || name.endsWith(DISABLED_COMMAND_SUFFIX);
}

/**
 * Parse a single slash command .md file and return a NormalizedTool.
 *
 * The command name is derived from the filename (without .md extension).
 * A `name.md.disabled` file is the same command, disabled, under the same
 * name -- so a profile or the tree can find it and re-enable it.
 * Frontmatter is optional -- commands work without it.
 */
export async function parseCommandFile(
  fileIO: FileIOService,
  schemaService: SchemaService,
  filePath: string,
  scope: ConfigScope,
): Promise<NormalizedTool> {
  const fileName = path.basename(filePath);
  const fileDisabled = fileName.endsWith(DISABLED_COMMAND_SUFFIX);
  const rawName = fileDisabled
    ? fileName.slice(0, -DISABLED_COMMAND_SUFFIX.length)
    : path.basename(filePath, '.md');
  const isDisabled = fileDisabled || rawName.endsWith('.disabled');
  const commandName = rawName.replace(/\.disabled$/, '');
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
      status: isDisabled ? ToolStatus.Disabled : ToolStatus.Enabled,
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
    status: isDisabled ? ToolStatus.Disabled : ToolStatus.Enabled,
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
 * Recursively find all command files in a commands directory and parse each one.
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
 * Recursively find all command files under a directory: `*.md`, and the
 * `*.md.disabled` files a disabled command is renamed to.
 *
 * Follows symlinks: symlinks to directories are traversed,
 * and symlinks to command files are included.
 */
async function findMdFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  // readdir order is unspecified. Sort by name so `x.md` precedes
  // `x.md.disabled`: both parse to one key, and the first one wins.
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findMdFiles(fullPath);
      results.push(...nested);
    } else if (entry.isSymbolicLink()) {
      // Resolve symlink to determine if it's a directory or file
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          const nested = await findMdFiles(fullPath);
          results.push(...nested);
        } else if (stat.isFile() && isCommandFileName(entry.name)) {
          results.push(fullPath);
        }
      } catch {
        // Broken symlink -- skip silently
      }
    } else if (entry.isFile() && isCommandFileName(entry.name)) {
      results.push(fullPath);
    }
  }

  return results;
}
