import * as path from 'path';
import { z } from 'zod';
import type { PluginDiagnostic, PluginMcpServer } from '../types/plugin.js';
import { MCP_CONFIG_SCHEMA_ID, RESERVED_ENV_NAMES, SUPPORTED_MCP_SCHEMA_IDS } from './plugin.constants.js';
import { expandPlaceholders } from './plugin.expand.js';
import { isContained, resolvePluginRelative } from './plugin.paths.js';

/**
 * `mcp.json` parsing and validation, Agent Plugins 1.0.0 §7.2 (plus §9.2
 * expansion and §10.1 version cross-check).
 *
 * Two failure boundaries, and the difference between them is the whole point of
 * this module (§7.2.2):
 *
 *   whole-file problem -> MCP is disabled for the plugin (`enabled: false`) and
 *                         the caller keeps loading other component types;
 *   per-entry problem  -> that server is skipped and its siblings survive.
 *
 * Validation is entirely local: clients MUST NOT retrieve a schema while
 * loading a plugin, so nothing here touches the network.
 */

/** Inputs the caller resolves before parsing. */
export interface ParseMcpConfigOptions {
  /** Filesystem-resolved plugin root, used for `${PLUGIN_ROOT}` and `./` paths. */
  pluginRoot: string;
  /**
   * Client-managed persistent data directory (§9.1). Absent when the caller has
   * none: entries that reference `${PLUGIN_DATA}` are then unresolvable and are
   * skipped as invalid entries, leaving their siblings alone.
   */
  pluginData?: string;
  /** The `$schema` value declared by `plugin.json`, for the §10.1 cross-check. */
  manifestSchema: string;
}

/** Outcome of parsing one `mcp.json`. */
export interface ParsedMcpConfig {
  /** False when a whole-file problem disabled MCP for the plugin (§7.2.2.2). */
  enabled: boolean;
  servers: PluginMcpServer[];
  diagnostics: PluginDiagnostic[];
}

// ---------------------------------------------------------------------------
// Structural schemas -- the closed variants of §7.2.1
// ---------------------------------------------------------------------------

const TopLevelSchema = z.strictObject({
  $schema: z.string(),
  mcpServers: z.record(z.string(), z.unknown()),
});

const StdioServerSchema = z.strictObject({
  type: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
});

const RemoteServerSchema = z.strictObject({
  type: z.enum(['streamable-http', 'sse']),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
});

/** RFC 7230 token, the grammar for an HTTP field name. */
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Visible ASCII, obs-text, space and horizontal tab -- an HTTP field value. */
const HEADER_VALUE_PATTERN = /^[\t\x20-\x7e\x80-\xff]*$/;

/** The two recognized placeholders, as they appear literally in a config value. */
const PLUGIN_ROOT_PLACEHOLDER = '${PLUGIN_ROOT}';
const PLUGIN_DATA_PLACEHOLDER = '${PLUGIN_DATA}';

type StdioServer = Extract<PluginMcpServer, { type: 'stdio' }>;
type RemoteServer = Extract<PluginMcpServer, { type: 'streamable-http' | 'sse' }>;

type EntryOutcome = { ok: true; server: PluginMcpServer } | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The Agent Plugins version a canonical schema identifier targets, or null when
 * the identifier does not have the canonical shape.
 */
function schemaVersionOf(schemaId: string): string | null {
  const match = /\/schemas\/([^/]+)\/[^/]+\.schema\.json$/.exec(schemaId);
  return match ? match[1] : null;
}

/**
 * Parse and validate a plugin's `mcp.json`.
 *
 * `rawJson` is the file's text; the caller has already established that
 * `mcp.json` exists and is a regular file within the plugin root (§6.2, §4.1).
 */
export async function parseMcpConfig(
  rawJson: string,
  options: ParseMcpConfigOptions,
): Promise<ParsedMcpConfig> {
  const fileRejected = (section: string, message: string): ParsedMcpConfig => ({
    enabled: false,
    servers: [],
    diagnostics: [{ severity: 'error', section, message }],
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fileRejected('7.2.2', `mcp.json is not valid JSON (${detail}); MCP is disabled.`);
  }

  const topLevel = TopLevelSchema.safeParse(parsed);
  if (!topLevel.success) {
    return fileRejected(
      '7.2.1',
      `mcp.json does not satisfy the top-level requirements (${describeIssues(topLevel.error)}); MCP is disabled.`,
    );
  }

  const declaredSchema = topLevel.data.$schema;
  if (!SUPPORTED_MCP_SCHEMA_IDS.includes(declaredSchema)) {
    return fileRejected(
      '7.2.1',
      `mcp.json declares an unsupported $schema "${declaredSchema}"; expected "${MCP_CONFIG_SCHEMA_ID}". MCP is disabled.`,
    );
  }

  // §10.1: mcp.json MUST target the same Agent Plugins version as plugin.json.
  // Redundant while exactly one identifier is supported, but it is the check
  // that has to hold if a compatibility mapping is ever added above.
  const manifestVersion = schemaVersionOf(options.manifestSchema);
  const mcpVersion = schemaVersionOf(declaredSchema);
  if (manifestVersion !== mcpVersion) {
    return fileRejected(
      '10.1',
      `mcp.json targets Agent Plugins ${mcpVersion ?? 'an unknown version'} but plugin.json targets ${manifestVersion ?? 'an unknown version'}; MCP is disabled.`,
    );
  }

  const servers: PluginMcpServer[] = [];
  const diagnostics: PluginDiagnostic[] = [];

  for (const [name, rawEntry] of Object.entries(topLevel.data.mcpServers)) {
    const outcome = await buildServer(name, rawEntry, options);
    if (outcome.ok) {
      servers.push(outcome.server);
    } else {
      diagnostics.push({
        severity: 'error',
        section: '7.2.2',
        subject: name,
        message: `MCP server entry is invalid and was skipped: ${outcome.reason}`,
      });
    }
  }

  return { enabled: true, servers, diagnostics };
}

/** Validate one `mcpServers` member against its declared variant (§7.2.1). */
async function buildServer(
  name: string,
  rawEntry: unknown,
  options: ParseMcpConfigOptions,
): Promise<EntryOutcome> {
  if (!isRecord(rawEntry)) {
    return { ok: false, reason: 'the entry is not an object.' };
  }

  const type = rawEntry.type;
  if (type === 'stdio') {
    const parsed = StdioServerSchema.safeParse(rawEntry);
    if (!parsed.success) {
      return { ok: false, reason: describeIssues(parsed.error) };
    }
    return buildStdioServer(name, parsed.data, options);
  }

  if (type === 'streamable-http' || type === 'sse') {
    const parsed = RemoteServerSchema.safeParse(rawEntry);
    if (!parsed.success) {
      return { ok: false, reason: describeIssues(parsed.error) };
    }
    return buildRemoteServer(name, parsed.data);
  }

  return {
    ok: false,
    reason: `unknown transport type ${JSON.stringify(type)}; expected "stdio", "streamable-http" or "sse".`,
  };
}

// ---------------------------------------------------------------------------
// stdio (§7.2.1, §9.2)
// ---------------------------------------------------------------------------

async function buildStdioServer(
  name: string,
  entry: z.infer<typeof StdioServerSchema>,
  options: ParseMcpConfigOptions,
): Promise<EntryOutcome> {
  const { pluginRoot, pluginData } = options;

  for (const key of Object.keys(entry.env ?? {})) {
    if (RESERVED_ENV_NAMES.includes(key)) {
      return {
        ok: false,
        reason: `env declares the reserved name "${key}", which the client supplies itself.`,
      };
    }
  }

  // Every field that expands (§9.2). With no PLUGIN_DATA directory the
  // reference cannot be resolved, so the entry -- and only the entry -- is out.
  const expandable = [...(entry.args ?? []), ...Object.values(entry.env ?? {})];
  if (entry.cwd !== undefined) {
    expandable.push(entry.cwd);
  }
  if (pluginData === undefined && expandable.some((value) => value.includes(PLUGIN_DATA_PLACEHOLDER))) {
    return {
      ok: false,
      reason: `it references ${PLUGIN_DATA_PLACEHOLDER} but no plugin data directory is available.`,
    };
  }

  const command = await resolveCommand(entry.command, pluginRoot);
  if (command === null) {
    return {
      ok: false,
      reason: `command ${JSON.stringify(entry.command)} is neither a bare executable name nor a plugin-relative "./" path inside the plugin root.`,
    };
  }

  const vars = { pluginRoot, pluginData: pluginData ?? '' };
  const cwd = await resolveCwd(entry.cwd, options, vars);
  if (cwd === null) {
    return {
      ok: false,
      reason: `cwd ${JSON.stringify(entry.cwd)} is not a permitted working directory form or escapes its root.`,
    };
  }

  const server: StdioServer = { name, type: 'stdio', command, cwd };
  if (entry.args !== undefined) {
    server.args = entry.args.map((arg) => expandPlaceholders(arg, vars));
  }
  if (entry.env !== undefined) {
    // Keys are never expanded (§9.2), only values.
    server.env = Object.fromEntries(
      Object.entries(entry.env).map(([key, value]) => [key, expandPlaceholders(value, vars)]),
    );
  }
  return { ok: true, server };
}

/**
 * Resolve `command` as a single executable token (§7.2.1).
 *
 * A `./` path resolves against the plugin root; a bare name is left untouched
 * for the platform's executable search. Anything else -- a shell string, a bare
 * relative path, an absolute path, an unexpanded placeholder -- is rejected,
 * since §9.2 does not expand `command`.
 */
async function resolveCommand(command: string, pluginRoot: string): Promise<string | null> {
  if (command.startsWith('./')) {
    return resolvePluginRelative(pluginRoot, command);
  }
  const isBareToken =
    command.length > 0 &&
    !/[\s/\\]/.test(command) &&
    command !== '.' &&
    command !== '..';
  return isBareToken ? command : null;
}

/**
 * Resolve `cwd` to an absolute directory (§7.2.1).
 *
 * The permitted forms are checked on the literal value -- `${PLUGIN_ROOT}x` and
 * `${HOME}/work` are not among them -- and only then expanded and tested for
 * containment within the root they claim. An omitted `cwd` is the plugin root.
 */
async function resolveCwd(
  cwd: string | undefined,
  options: ParseMcpConfigOptions,
  vars: { pluginRoot: string; pluginData: string },
): Promise<string | null> {
  const { pluginRoot, pluginData } = options;

  if (cwd === undefined) {
    return pluginRoot;
  }

  if (cwd.startsWith('./')) {
    return resolvePluginRelative(pluginRoot, cwd);
  }

  const anchor = anchorOf(cwd);
  if (anchor === null) {
    return null;
  }

  const base = anchor === 'root' ? pluginRoot : pluginData;
  if (base === undefined) {
    return null;
  }

  const resolved = path.resolve(expandPlaceholders(cwd, vars));
  return (await isContained(base, resolved)) ? resolved : null;
}

/** Which placeholder a `cwd` value is rooted at, or null if it is rooted at neither. */
function anchorOf(cwd: string): 'root' | 'data' | null {
  if (cwd === PLUGIN_ROOT_PLACEHOLDER || cwd.startsWith(`${PLUGIN_ROOT_PLACEHOLDER}/`)) {
    return 'root';
  }
  if (cwd === PLUGIN_DATA_PLACEHOLDER || cwd.startsWith(`${PLUGIN_DATA_PLACEHOLDER}/`)) {
    return 'data';
  }
  return null;
}

// ---------------------------------------------------------------------------
// streamable-http / sse (§7.2.1)
// ---------------------------------------------------------------------------

function buildRemoteServer(
  name: string,
  entry: z.infer<typeof RemoteServerSchema>,
): EntryOutcome {
  const urlProblem = validateEndpointUrl(entry.url);
  if (urlProblem !== null) {
    return { ok: false, reason: `url ${JSON.stringify(entry.url)} ${urlProblem}` };
  }

  const headerProblem = entry.headers ? validateHeaders(entry.headers) : null;
  if (headerProblem !== null) {
    return { ok: false, reason: headerProblem };
  }

  // The raw string is kept: placeholders and header values are never expanded
  // (§7.2.1), and re-serializing a parsed URL would normalize it.
  const server: RemoteServer = { name, type: entry.type, url: entry.url };
  if (entry.headers !== undefined) {
    server.headers = { ...entry.headers };
  }
  return { ok: true, server };
}

/** Why `raw` is not a usable MCP endpoint URL, or null when it is. */
function validateEndpointUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'is not an absolute URL.';
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'does not use the http or https scheme.';
  }
  if (url.username !== '' || url.password !== '') {
    return 'contains user information.';
  }
  // `new URL(...).hash` is empty for both "no fragment" and a bare trailing
  // "#", so the literal is what decides.
  if (raw.includes('#')) {
    return 'contains a fragment.';
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    return 'uses http on a non-loopback host; only https is permitted there.';
  }
  return null;
}

/** Whether `hostname` is exactly `localhost` or an IP literal in a loopback range. */
function isLoopbackHost(hostname: string): boolean {
  if (hostname === 'localhost') {
    return true;
  }
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1) === '::1';
  }
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

/** Why `headers` is unusable, or null when it is well formed. */
function validateHeaders(headers: Record<string, string>): string | null {
  const seen = new Map<string, string>();
  for (const [name, value] of Object.entries(headers)) {
    if (!HEADER_NAME_PATTERN.test(name)) {
      return `header name ${JSON.stringify(name)} is not a valid HTTP field name.`;
    }
    if (!HEADER_VALUE_PATTERN.test(value)) {
      return `the value of header ${JSON.stringify(name)} is not a valid HTTP field value.`;
    }
    // Header names are case-insensitive, so two casings are one duplicated name.
    const lower = name.toLowerCase();
    const previous = seen.get(lower);
    if (previous !== undefined) {
      return `headers repeat ${JSON.stringify(previous)} as ${JSON.stringify(name)}; header names are case-insensitive.`;
    }
    seen.set(lower, name);
  }
  return null;
}

/** Flatten zod issues into one line, keeping the field path that failed. */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ');
}
