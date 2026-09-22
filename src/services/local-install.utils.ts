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

/** The provider surface the scope probes need — one probe per installable type. */
type ScopeProbeProvider = Pick<
  AgentProvider,
  'getSkillsDir' | 'getCommandsDir' | 'getMcpFilePath'
>;

/** Scope preference order; every returned list follows it. */
const SCOPE_ORDER = [ConfigScope.User, ConfigScope.Project] as const;

/**
 * Determine which scopes the active provider can install the given tool type into.
 *
 * Probes `getSkillsDir`/`getCommandsDir`/`getMcpFilePath` per candidate scope
 * rather than checking provider identity, so a new provider needs no change here.
 *
 * The Project fallback for `'skill'`/`'command'` is deliberately NOT symmetric
 * with `'mcp_server'` — do not "tidy" it into symmetry. It exists for a provider
 * that installs into the workspace without a resolvable directory: Copilot's
 * `getSkillsDir` is unwired while its `installSkill` still writes to
 * `.github/agents/`, so an empty probe there does not mean there is nowhere to
 * land. No provider has that shape for MCP — an MCP config path that resolves
 * nowhere means genuinely nowhere to write — so `'mcp_server'` returns no scopes
 * instead, and the caller may honestly say so.
 */
export function resolveInstallScopes(
  provider: ScopeProbeProvider,
  type: 'skill' | 'command' | 'mcp_server',
  hasWorkspace: boolean,
): ConfigScope[] {
  const candidates = hasWorkspace
    ? [ConfigScope.User, ConfigScope.Project]
    : [ConfigScope.User];
  const resolve = (scope: ConfigScope): string => {
    switch (type) {
      case 'skill':
        return provider.getSkillsDir(scope);
      case 'command':
        return provider.getCommandsDir(scope);
      case 'mcp_server':
        return provider.getMcpFilePath(scope);
    }
  };

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
  if (type === 'mcp_server') {
    return [];
  }
  return hasWorkspace ? [ConfigScope.Project] : [];
}

/**
 * Which scopes an Agent Plugin as a whole can be installed into.
 *
 * A plugin may ship skills, MCP servers, or both, so probing either component
 * type alone gets the answer wrong for a package that does not contain it — the
 * skills-only probe is what made an MCP-only plugin uninstallable for Copilot
 * with no workspace open (addendum §A5). The union is safe because the fan-out
 * already isolates per component (§11.3): a scope that suits only one component
 * type costs the other component a skip, never the install.
 */
export function resolvePluginInstallScopes(
  provider: ScopeProbeProvider,
  hasWorkspace: boolean,
): ConfigScope[] {
  const union = new Set([
    ...resolveInstallScopes(provider, 'skill', hasWorkspace),
    ...resolveInstallScopes(provider, 'mcp_server', hasWorkspace),
  ]);
  return SCOPE_ORDER.filter((scope) => union.has(scope));
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
