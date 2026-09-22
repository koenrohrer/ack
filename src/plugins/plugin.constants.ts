/**
 * Canonical identifiers and fixed locations of the Agent Plugins 1.0.0 format.
 *
 * The `$schema` values below are normative constants of the format (§5.2,
 * §7.2.1), not URLs to be retrieved: clients MUST NOT fetch a schema while
 * loading a plugin, so validation in this package is entirely local.
 */

/** Agent Plugins specification version implemented here. */
export const AGENT_PLUGINS_VERSION = '1.0.0';

/** Canonical `$schema` value for `plugin.json` (§5.2). */
export const PLUGIN_MANIFEST_SCHEMA_ID =
  'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';

/** Canonical `$schema` value for `mcp.json` (§7.2.1). */
export const MCP_CONFIG_SCHEMA_ID = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';

/**
 * Manifest schema identifiers this client recognizes.
 *
 * A client MAY map several canonical identifiers to one implementation, but
 * only when it explicitly recognizes those versions as compatible (§5.2), so
 * this list grows only alongside a deliberate compatibility decision.
 */
export const SUPPORTED_MANIFEST_SCHEMA_IDS: readonly string[] = [PLUGIN_MANIFEST_SCHEMA_ID];

/** MCP configuration schema identifiers this client recognizes (§7.2.1). */
export const SUPPORTED_MCP_SCHEMA_IDS: readonly string[] = [MCP_CONFIG_SCHEMA_ID];

/** Fixed manifest location, relative to the plugin root (§5.1). */
export const MANIFEST_FILENAME = 'plugin.json';

/** Fixed MCP configuration location, relative to the plugin root (§7.2.1). */
export const MCP_CONFIG_FILENAME = 'mcp.json';

/** Fixed skills discovery location, relative to the plugin root (§6.1). */
export const SKILLS_DIRNAME = 'skills';

/** The file whose presence makes an immediate child of `skills/` a skill (§7.1). */
export const SKILL_FILENAME = 'SKILL.md';

/** The closed set of top-level `plugin.json` fields (§5.2). */
export const MANIFEST_FIELDS: readonly string[] = [
  '$schema',
  'name',
  'version',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'extensions',
];

/**
 * Environment names the client supplies itself; a server `env` object
 * declaring either one is invalid (§9.2).
 */
export const RESERVED_ENV_NAMES: readonly string[] = ['PLUGIN_ROOT', 'PLUGIN_DATA'];
