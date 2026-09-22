import * as fs from 'fs/promises';
import type { Stats } from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type {
  PluginDiagnostic,
  PluginLoadResult,
  PluginManifest,
  PluginMcpServer,
  PluginSkill,
} from '../types/plugin.js';
import {
  MANIFEST_FIELDS,
  MANIFEST_FILENAME,
  MCP_CONFIG_FILENAME,
  PLUGIN_MANIFEST_SCHEMA_ID,
  SKILLS_DIRNAME,
  SKILL_FILENAME,
  SUPPORTED_MANIFEST_SCHEMA_IDS,
} from './plugin.constants.js';
import { parseMcpConfig } from './plugin.mcp.js';
import { isValidPluginName } from './plugin.name.js';
import { isContained } from './plugin.paths.js';

/**
 * Plugin loading, Agent Plugins 1.0.0 §5 (manifest) -> §6 (discovery) ->
 * §7 (component types), under the §11.3 resilience rules.
 *
 * Only a fatal `plugin.json` problem rejects the plugin. Every other failure is
 * isolated to the narrowest applicable boundary (§4.1) and reported as a
 * diagnostic on an otherwise loaded plugin. Nothing here touches the network:
 * §5.2 forbids retrieving a schema while loading.
 */

/** Optional inputs the client supplies. */
export interface LoadPluginOptions {
  /**
   * Absolute path to the client-managed persistent data directory for this
   * installed plugin instance (§9.1). It MUST NOT be derived from the plugin
   * root: the root is exactly what a plugin update replaces, and PLUGIN_DATA
   * has to survive that. When absent, MCP entries referencing `${PLUGIN_DATA}`
   * are skipped as invalid entries.
   */
  pluginData?: string;
}

/**
 * The closed manifest schema (§5.2), minus the two non-fatal exceptions.
 *
 * Unknown top-level fields and a non-object `extensions` are stripped and
 * reported before this runs, so anything this rejects is fatal. Metadata is
 * checked by JSON type only (§5.4) -- no semver, URL, email or SPDX rules.
 */
const ManifestSchema = z.strictObject({
  $schema: z.string(),
  name: z.string(),
  version: z.string().optional(),
  description: z.string().optional(),
  author: z
    .strictObject({
      name: z.string().optional(),
      email: z.string().optional(),
      url: z.string().optional(),
    })
    .optional(),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  license: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  // Namespace values MUST be objects (§8.1), but their contents are never
  // inspected (§11.1.3) -- z.custom passes the value through untouched.
  extensions: z
    .record(
      z.string(),
      z.custom<Record<string, unknown>>(
        (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
        { message: 'Expected an object' },
      ),
    )
    .optional(),
});

/** Rejects a top level that is not a JSON object (array, string, number, null). */
const JsonObjectSchema = z.record(z.string(), z.unknown());

/**
 * Load the plugin package rooted at `rootDir`.
 *
 * Resolves to `{ ok: false, diagnostics }` only for a fatal `plugin.json`
 * problem, in which case no component is discovered at all (§5.2). Otherwise
 * resolves to `{ ok: true, plugin }`, whose `diagnostics` describe every
 * component that was skipped.
 */
export async function loadPlugin(
  rootDir: string,
  opts?: LoadPluginOptions,
): Promise<PluginLoadResult> {
  let root: string;
  try {
    root = await fs.realpath(path.resolve(rootDir));
  } catch (error) {
    return rejected('4.1', `the plugin root ${JSON.stringify(rootDir)} cannot be resolved: ${describeError(error)}`);
  }

  const diagnostics: PluginDiagnostic[] = [];
  const manifestResult = await loadManifest(root, diagnostics);
  if (!manifestResult.ok) {
    return { ok: false, diagnostics: [...diagnostics, ...manifestResult.diagnostics] };
  }
  const manifest = manifestResult.manifest;

  const skills = await discoverSkills(root, diagnostics);
  const mcpServers = await discoverMcpServers(root, manifest, opts?.pluginData, diagnostics);

  return { ok: true, plugin: { root, manifest, skills, mcpServers, diagnostics } };
}

// ---------------------------------------------------------------------------
// Manifest (§5)
// ---------------------------------------------------------------------------

type ManifestOutcome =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; diagnostics: PluginDiagnostic[] };

/**
 * Read and validate `plugin.json`.
 *
 * Non-fatal exceptions are handled first: unknown top-level fields and a
 * non-object `extensions` are reported into `diagnostics`, stripped, and the
 * remainder is then validated strictly. A plain strict schema gets this
 * backwards -- it would reject the plugin over a stray field.
 */
async function loadManifest(root: string, diagnostics: PluginDiagnostic[]): Promise<ManifestOutcome> {
  const manifestPath = path.join(root, MANIFEST_FILENAME);

  if (!(await isContained(root, manifestPath))) {
    return fatal('4.1', `${MANIFEST_FILENAME} does not resolve within the plugin root.`);
  }

  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, 'utf-8');
  } catch (error) {
    return fatal('5.1', `${MANIFEST_FILENAME} could not be read: ${describeError(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return fatal('5.2', `${MANIFEST_FILENAME} is not valid JSON: ${describeError(error)}`);
  }

  const asObject = JsonObjectSchema.safeParse(parsed);
  if (!asObject.success) {
    return fatal('5.2', `${MANIFEST_FILENAME} does not contain a top-level JSON object.`);
  }

  const known: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(asObject.data)) {
    if (!MANIFEST_FIELDS.includes(key)) {
      diagnostics.push({
        severity: 'warning',
        section: '5.2',
        subject: key,
        message: `Unknown top-level field "${key}" in ${MANIFEST_FILENAME} was ignored.`,
      });
      continue;
    }
    known[key] = value;
  }

  // §8.1: a non-object `extensions` is reported and ignored, not fatal. A
  // non-object *member* of a well-formed `extensions` still is fatal.
  if ('extensions' in known && !isPlainObject(known.extensions)) {
    diagnostics.push({
      severity: 'warning',
      section: '8.1',
      subject: 'extensions',
      message: `The "extensions" field in ${MANIFEST_FILENAME} is not an object and was ignored.`,
    });
    delete known.extensions;
  }

  const validated = ManifestSchema.safeParse(known);
  if (!validated.success) {
    return fatal('5.2', `${MANIFEST_FILENAME} is invalid: ${describeIssues(validated.error)}`);
  }

  const manifest = validated.data as PluginManifest;

  if (!SUPPORTED_MANIFEST_SCHEMA_IDS.includes(manifest.$schema)) {
    return fatal(
      '5.2',
      `${MANIFEST_FILENAME} declares an unsupported $schema "${manifest.$schema}"; expected "${PLUGIN_MANIFEST_SCHEMA_ID}".`,
    );
  }

  if (!isValidPluginName(manifest.name)) {
    return fatal('5.5', `The plugin name ${JSON.stringify(manifest.name)} violates the §5.5 constraints.`);
  }

  return { ok: true, manifest };
}

// ---------------------------------------------------------------------------
// Skills (§6.1, §6.2, §7.1)
// ---------------------------------------------------------------------------

/**
 * Discover skills under the fixed `skills/` location.
 *
 * Each immediate child directory holding a regular `SKILL.md` file is one
 * skill; the search never recurses, so `skills/a/b/SKILL.md` is not a skill
 * (§7.1). An absent `skills/` is not an error (§6.2). ACK does not own the
 * Agent Skills format, so `SKILL.md` itself is not parsed here.
 */
async function discoverSkills(root: string, diagnostics: PluginDiagnostic[]): Promise<PluginSkill[]> {
  const skillsDir = path.join(root, SKILLS_DIRNAME);
  const dirStats = await statOrNull(skillsDir);
  if (dirStats === null) {
    return [];
  }

  const skipComponentType = (section: string, message: string): PluginSkill[] => {
    diagnostics.push({ severity: 'error', section, subject: SKILLS_DIRNAME, message });
    return [];
  };

  if (!dirStats.isDirectory()) {
    return skipComponentType('6.2', `"${SKILLS_DIRNAME}" is not a directory; the skills component type was skipped.`);
  }
  if (!(await isContained(root, skillsDir))) {
    return skipComponentType('4.1', `"${SKILLS_DIRNAME}" does not resolve within the plugin root; the skills component type was skipped.`);
  }

  let entries;
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch (error) {
    return skipComponentType('6.2', `"${SKILLS_DIRNAME}" could not be read: ${describeError(error)}`);
  }

  const skipSkill = (section: string, name: string, message: string): void => {
    diagnostics.push({ severity: 'error', section, subject: name, message });
  };

  const skills: PluginSkill[] = [];
  for (const entry of entries.sort(byName)) {
    const dir = path.join(skillsDir, entry.name);

    // Follows links: a symlinked directory is still an immediate child
    // directory, and a loose file under skills/ is simply not a skill.
    const stats = await statOrNull(dir);
    if (stats === null || !stats.isDirectory()) {
      continue;
    }
    if (!(await isContained(root, dir))) {
      skipSkill('4.1', entry.name, `Skill "${entry.name}" resolves outside the plugin root and was skipped.`);
      continue;
    }

    const skillFile = path.join(dir, SKILL_FILENAME);
    const skillStats = await statOrNull(skillFile);
    if (skillStats === null || !skillStats.isFile()) {
      skipSkill('7.1', entry.name, `Skill "${entry.name}" has no ${SKILL_FILENAME} regular file and was skipped.`);
      continue;
    }
    if (!(await isContained(root, skillFile))) {
      skipSkill('4.1', entry.name, `The ${SKILL_FILENAME} of skill "${entry.name}" resolves outside the plugin root and was skipped.`);
      continue;
    }

    skills.push({ name: entry.name, dir, skillFile });
  }

  return skills;
}

// ---------------------------------------------------------------------------
// MCP servers (§6.2, §7.2)
// ---------------------------------------------------------------------------

/**
 * Read the fixed `mcp.json` location and hand its contents to the §7.2 parser.
 *
 * An absent `mcp.json` is not an error (§6.2); anything wrong with the file as
 * a whole disables MCP for the plugin while other component types keep loading.
 */
async function discoverMcpServers(
  root: string,
  manifest: PluginManifest,
  pluginData: string | undefined,
  diagnostics: PluginDiagnostic[],
): Promise<PluginMcpServer[]> {
  const configPath = path.join(root, MCP_CONFIG_FILENAME);
  const stats = await statOrNull(configPath);
  if (stats === null) {
    return [];
  }

  const disableMcp = (section: string, message: string): PluginMcpServer[] => {
    diagnostics.push({ severity: 'error', section, subject: MCP_CONFIG_FILENAME, message });
    return [];
  };

  if (!stats.isFile()) {
    return disableMcp('6.2', `"${MCP_CONFIG_FILENAME}" is not a regular file; MCP is disabled for this plugin.`);
  }
  if (!(await isContained(root, configPath))) {
    return disableMcp('4.1', `"${MCP_CONFIG_FILENAME}" does not resolve within the plugin root; MCP is disabled for this plugin.`);
  }

  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf-8');
  } catch (error) {
    return disableMcp('7.2.2', `"${MCP_CONFIG_FILENAME}" could not be read: ${describeError(error)}`);
  }

  const result = await parseMcpConfig(raw, {
    pluginRoot: root,
    pluginData,
    manifestSchema: manifest.$schema,
  });
  diagnostics.push(...result.diagnostics);
  return result.servers;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rejected(section: string, message: string): PluginLoadResult {
  return { ok: false, diagnostics: [{ severity: 'error', section, message }] };
}

function fatal(section: string, message: string): ManifestOutcome {
  return { ok: false, diagnostics: [{ severity: 'error', section, message }] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Stat `target`, following links, or null when it does not exist. */
async function statOrNull(target: string): Promise<Stats | null> {
  try {
    return await fs.stat(target);
  } catch {
    return null;
  }
}

/** Codepoint order, so discovery output does not depend on readdir order. */
function byName(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Flatten zod issues into one line, keeping the field path that failed. */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ');
}
