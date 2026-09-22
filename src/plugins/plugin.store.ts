import * as fs from 'fs/promises';
import type { Stats } from 'fs';
import * as path from 'path';
import type { AgentPlugin, PluginDiagnostic } from '../types/plugin.js';
import { loadPlugin } from './plugin.loader.js';
import { isValidPluginName } from './plugin.name.js';
import { isContained } from './plugin.paths.js';

/**
 * The managed plugin store: ACK copies a plugin package in, and owns exactly two
 * sibling trees and nothing else.
 *
 *   <pluginsDir>/<plugin-name>/  -> PLUGIN_ROOT  (replaced on update)
 *   <dataRoot>/<plugin-name>/    -> PLUGIN_DATA  (preserved on update, §9.1)
 *
 * Agent Plugins 1.0.0 §9.1 makes PLUGIN_DATA client-managed: the client MUST
 * create it, MUST make it writable, and MUST preserve its contents across
 * updates -- which a path derived from the plugin root cannot do, since the root
 * is exactly what an update replaces. §4.1 containment is likewise defined
 * against a stable root, and a user-chosen source directory can move or vanish.
 *
 * Both base directories are constructor arguments: nothing here may import
 * `vscode`, so the caller resolves them (from `globalStorageUri`) and tests can
 * point them at a temp dir.
 */

/** One installed plugin, as derived from what is on disk right now. */
export interface InstalledPluginRecord {
  name: string;
  version?: string;
  /** Absolute path under the plugins tree -- PLUGIN_ROOT (§9.1). */
  root: string;
  /** Absolute path under the plugin-data tree -- PLUGIN_DATA (§9.1). */
  dataDir: string;
  /** ISO-8601 UTC instant the root tree was last written. */
  installedAt: string;
  /**
   * Where the package was copied from, for user reference.
   *
   * Only `install` knows this. The store keeps no index (DESIGN-phase2.md rule
   * 5), so a record derived later by `list`/`get` reports the installed root --
   * the origin of an already-installed package is not recorded anywhere.
   */
  sourcePath: string;
}

/** The pair of owned paths for one plugin name. */
interface OwnedPaths {
  root: string;
  dataDir: string;
}

export class PluginStore {
  constructor(
    private readonly pluginsDir: string,
    private readonly dataRoot: string,
  ) {}

  /**
   * Every installed plugin, derived from disk on each call.
   *
   * Nothing under the plugins tree is trusted to be a plugin: a loose file, an
   * empty directory, an unparseable manifest or a package whose manifest name
   * disagrees with its directory is skipped, never reported and never fatal.
   */
  async list(): Promise<InstalledPluginRecord[]> {
    let entries;
    try {
      entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const records: InstalledPluginRecord[] = [];
    for (const entry of entries.sort(byName)) {
      const record = await this.get(entry.name);
      if (record !== undefined) {
        records.push(record);
      }
    }
    return records;
  }

  /**
   * The record for `name`, or undefined when it is not installed.
   *
   * `name` is an arbitrary caller string, so it is validated against §5.5 and
   * then re-checked for containment after being joined -- §5.5 already bars `/`
   * and `\`, but a name is never used as a path segment on that basis alone.
   */
  async get(name: string): Promise<InstalledPluginRecord | undefined> {
    const owned = await this.resolveOwned(name);
    if (owned === undefined) {
      return undefined;
    }

    const loaded = await loadPlugin(owned.root);
    if (!loaded.ok || loaded.plugin.manifest.name !== name) {
      return undefined;
    }
    return this.recordFor(loaded.plugin, owned, owned.root);
  }

  /**
   * Install the plugin package at `sourceDir` into the store.
   *
   * Rejects when the source is fatally invalid (§5.2, §11.3.2), having copied
   * nothing. The returned `plugin` describes the INSTALLED copy: see the
   * two-load sequence below.
   */
  async install(sourceDir: string): Promise<{ record: InstalledPluginRecord; plugin: AgentPlugin }> {
    const sourcePath = path.resolve(sourceDir);

    // (1) Validate the source. This load's resolved paths point at the source
    // and are deliberately discarded -- the source is exactly the directory the
    // managed store exists to stop depending on.
    const validated = await loadPlugin(sourcePath);
    if (!validated.ok) {
      throw new Error(
        `The plugin at ${JSON.stringify(sourceDir)} could not be installed: ${describeDiagnostics(validated.diagnostics)}`,
      );
    }

    const name = validated.plugin.manifest.name;
    const owned = await this.resolveOwned(name);
    if (owned === undefined) {
      throw new Error(
        `The plugin name ${JSON.stringify(name)} does not resolve to a path inside the managed store.`,
      );
    }

    // (1b) Refuse a source that overlaps PLUGIN_ROOT, before anything is
    // written. A source equal to or inside the root is deleted by the replace
    // below; a source containing the root is copied into itself until the
    // path is too long. isContained resolves symlinks on both sides, so a link
    // to the installed root is caught as well.
    if ((await isContained(owned.root, sourcePath)) || (await isContained(sourcePath, owned.root))) {
      throw new Error(
        `The plugin at ${JSON.stringify(sourceDir)} overlaps its install location ${JSON.stringify(owned.root)}. Choose a source directory outside the managed plugin store.`,
      );
    }

    // (2) PLUGIN_DATA: created if absent, and otherwise left completely alone.
    // §9.1 requires its contents to survive an update, so an existing data
    // directory is never cleared, replaced or read here.
    await fs.mkdir(owned.dataDir, { recursive: true });

    // (3) PLUGIN_ROOT: replaced, not merged. A file the previous version
    // shipped and this one does not must not linger in the installed package.
    //
    // The new copy is built in a staging directory beside the root and loaded
    // there first; only then is it swapped in by rename. A copy or load that
    // fails leaves the installed version exactly as it was. The staging and
    // set-aside names start with `.`, which §5.5 forbids in a plugin name, so
    // `list` never reports either one.
    const copyDiagnostics: PluginDiagnostic[] = [];
    await fs.mkdir(this.pluginsDir, { recursive: true });
    const staging = await fs.mkdtemp(path.join(this.pluginsDir, `.staging-${name}-`));
    const setAside = `${staging}-previous`;
    let previousSetAside = false;
    try {
      await copyContained(
        validated.plugin.root,
        validated.plugin.root,
        staging,
        copyDiagnostics,
        new Set([validated.plugin.root]),
      );
      const staged = await loadPlugin(staging, { pluginData: owned.dataDir });
      if (!staged.ok) {
        throw new Error(
          `The plugin ${JSON.stringify(name)} was copied into the store but no longer loads: ${describeDiagnostics(staged.diagnostics)}`,
        );
      }
      if (await entryExists(owned.root)) {
        await fs.rename(owned.root, setAside);
        previousSetAside = true;
      }
      await fs.rename(staging, owned.root);
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true });
      if (previousSetAside) {
        await fs.rename(setAside, owned.root);
      }
      throw error;
    }

    // (4) Re-load from the installed location, with the data directory this
    // store owns. Only this result has every `${PLUGIN_ROOT}`/`${PLUGIN_DATA}`
    // expansion (§9.2), every `./` command and every cwd resolved against the
    // store, so only this result is safe to write into an agent's config.
    const installed = await loadPlugin(owned.root, { pluginData: owned.dataDir });
    if (!installed.ok) {
      // Put the previous version back; the new copy loaded from staging, so
      // reaching here means the filesystem changed underneath the install.
      await fs.rm(owned.root, { recursive: true, force: true });
      if (previousSetAside) {
        await fs.rename(setAside, owned.root);
      }
      throw new Error(
        `The plugin ${JSON.stringify(name)} was copied into the store but no longer loads: ${describeDiagnostics(installed.diagnostics)}`,
      );
    }
    if (previousSetAside) {
      await fs.rm(setAside, { recursive: true, force: true });
    }
    installed.plugin.diagnostics.push(...copyDiagnostics);

    return {
      record: await this.recordFor(installed.plugin, owned, sourcePath),
      plugin: installed.plugin,
    };
  }

  /**
   * Remove both owned trees for `name`, and nothing else.
   *
   * §9.1 permits deleting PLUGIN_DATA on uninstall; DESIGN-phase2.md rule 4
   * takes that permission, after the root. A name that is not installed, or one
   * that does not resolve inside the owned trees, deletes nothing and does not
   * throw.
   */
  async uninstall(name: string): Promise<void> {
    const owned = await this.resolveOwned(name);
    if (owned === undefined) {
      return;
    }
    await fs.rm(owned.root, { recursive: true, force: true });
    await fs.rm(owned.dataDir, { recursive: true, force: true });
  }

  /**
   * The two owned paths for `name`, or undefined when the name may not be used
   * as a path segment of either tree (§4.1, §5.5).
   */
  private async resolveOwned(name: string): Promise<OwnedPaths | undefined> {
    if (!isValidPluginName(name)) {
      return undefined;
    }
    const root = path.join(this.pluginsDir, name);
    const dataDir = path.join(this.dataRoot, name);
    if (!(await isContained(this.pluginsDir, root)) || !(await isContained(this.dataRoot, dataDir))) {
      return undefined;
    }
    return { root, dataDir };
  }

  /**
   * Build a record from a loaded package. Name and version come from the
   * manifest as just read, never from an index file that could drift from the
   * package it claims to describe (DESIGN-phase2.md rule 5).
   */
  private async recordFor(
    plugin: AgentPlugin,
    owned: OwnedPaths,
    sourcePath: string,
  ): Promise<InstalledPluginRecord> {
    return {
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      root: owned.root,
      dataDir: owned.dataDir,
      installedAt: await installedAtOf(owned.root),
      sourcePath,
    };
  }
}

// ---------------------------------------------------------------------------
// Copying, under §4.1 containment
// ---------------------------------------------------------------------------

/**
 * Copy the contents of `from` into `to`, entry by entry, refusing anything that
 * leaves `sourceRoot`.
 *
 * §4.1.3 permits symlinks that resolve inside the plugin root and requires
 * rejecting package paths that resolve outside it. Every entry is therefore
 * checked with `isContained` -- which resolves links -- before it is read: an
 * escaping link is neither dereferenced nor recreated in the store, and a
 * dangling link fails containment and is never written either. §4.1.5's
 * narrowest applicable boundary is "deny access to that path", so an escaping
 * entry is skipped with a diagnostic and the rest of the package installs.
 *
 * Links that stay inside the root are copied as the file they point at rather
 * than recreated, so nothing in the store can later be repointed outside it.
 * `visited` holds the resolved directories already descended into, which is what
 * stops a link back up the tree from recursing forever.
 */
async function copyContained(
  sourceRoot: string,
  from: string,
  to: string,
  diagnostics: PluginDiagnostic[],
  visited: Set<string>,
): Promise<void> {
  const entries = await fs.readdir(from, { withFileTypes: true });

  for (const entry of entries.sort(byName)) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    const subject = path.relative(sourceRoot, source);

    if (!(await isContained(sourceRoot, source))) {
      skipEntry(diagnostics, subject, 'it does not resolve within the plugin root');
      continue;
    }

    const stats = await statOrNull(source);
    if (stats === null) {
      skipEntry(diagnostics, subject, 'it could not be read');
      continue;
    }

    if (stats.isDirectory()) {
      const resolved = await realpathOrNull(source);
      if (resolved === null || visited.has(resolved)) {
        skipEntry(diagnostics, subject, 'it resolves to a directory already being copied');
        continue;
      }
      visited.add(resolved);
      await fs.mkdir(target, { recursive: true });
      await copyContained(sourceRoot, source, target, diagnostics, visited);
      continue;
    }

    if (!stats.isFile()) {
      skipEntry(diagnostics, subject, 'it is not a regular file or directory');
      continue;
    }

    // Dereferences a link, which containment has already confined to the root.
    await fs.copyFile(source, target);
  }
}

function skipEntry(diagnostics: PluginDiagnostic[], subject: string, reason: string): void {
  diagnostics.push({
    severity: 'error',
    section: '4.1',
    subject,
    message: `Package path "${subject}" was not copied into the managed store because ${reason}.`,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * When the root tree was last written, as a canonical ISO-8601 UTC instant.
 *
 * Read from the directory rather than recorded, so it cannot disagree with the
 * package: install replaces the root, and a directory's mtime moves with its
 * own entries. Editing a file already inside the package does not move it.
 */
async function installedAtOf(root: string): Promise<string> {
  const stats = await statOrNull(root);
  return (stats?.mtime ?? new Date()).toISOString();
}

/** Whether an entry exists at `target`, without following a final symlink. */
async function entryExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

/** Stat `target`, following links, or null when it cannot be resolved. */
async function statOrNull(target: string): Promise<Stats | null> {
  try {
    return await fs.stat(target);
  } catch {
    return null;
  }
}

async function realpathOrNull(target: string): Promise<string | null> {
  try {
    return await fs.realpath(target);
  } catch {
    return null;
  }
}

/** Codepoint order, so the copy does not depend on readdir order. */
function byName(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** Flatten loader diagnostics into one line for a rejection message. */
function describeDiagnostics(diagnostics: PluginDiagnostic[]): string {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  return (errors.length > 0 ? errors : diagnostics)
    .map((diagnostic) => `§${diagnostic.section} ${diagnostic.message}`)
    .join('; ');
}
