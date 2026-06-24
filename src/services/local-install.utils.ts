import { readdir, readFile } from 'fs/promises';
import * as path from 'path';
import { ConfigScope } from '../types/enums.js';
import type { AgentProvider } from '../types/provider.js';

/** A file to install: its base name and text content. */
export interface NamedFile {
  name: string;
  content: string;
}

/**
 * Read the top-level files of a directory as `NamedFile`s.
 *
 * Subdirectories are not descended into — the install providers write a flat
 * file set into a single target directory — so any nested folders are
 * reported in `skippedDirs` for the caller to surface (no silent truncation).
 */
export async function readDirFiles(
  dir: string,
): Promise<{ files: NamedFile[]; skippedDirs: string[] }> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: NamedFile[] = [];
  const skippedDirs: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      skippedDirs.push(entry.name);
    } else if (entry.isFile()) {
      files.push({
        name: entry.name,
        content: await readFile(path.join(dir, entry.name), 'utf-8'),
      });
    }
  }
  return { files, skippedDirs };
}

/**
 * Determine which scopes the active provider can install the given tool type into.
 *
 * Probes `getSkillsDir`/`getCommandsDir` per candidate scope rather than checking
 * provider identity, so a new provider needs no change here. A provider that
 * installs to the workspace without a resolvable directory (e.g. Copilot agents,
 * whose `getSkillsDir` is not wired but whose `installSkill` writes to
 * `.github/agents/`) reports no scopes; we then fall back to Project when a
 * workspace is open.
 */
export function resolveInstallScopes(
  provider: Pick<AgentProvider, 'getSkillsDir' | 'getCommandsDir'>,
  type: 'skill' | 'command',
  hasWorkspace: boolean,
): ConfigScope[] {
  const candidates = hasWorkspace
    ? [ConfigScope.User, ConfigScope.Project]
    : [ConfigScope.User];
  const resolve = (scope: ConfigScope): string =>
    type === 'skill' ? provider.getSkillsDir(scope) : provider.getCommandsDir(scope);

  const valid = candidates.filter((scope) => {
    try {
      resolve(scope);
      return true;
    } catch {
      return false;
    }
  });

  if (valid.length > 0) {
    return valid;
  }
  return hasWorkspace ? [ConfigScope.Project] : [];
}

/** Build the post-install confirmation message, noting any skipped subfolders. */
export function buildInstalledMessage(
  label: string,
  name: string,
  fileCount: number,
  skippedDirs: string[],
): string {
  let msg = `${label} "${name}" installed (${fileCount} file${fileCount === 1 ? '' : 's'}).`;
  if (skippedDirs.length > 0) {
    msg += ` Subfolders not copied: ${skippedDirs.join(', ')}.`;
  }
  return msg;
}
