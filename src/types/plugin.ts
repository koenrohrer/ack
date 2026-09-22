/**
 * Types for the Agent Plugins 1.0.0 portable package format.
 *
 * ACK is a config manager, not an agent runtime: it loads and validates a
 * plugin package, then translates it into the active agent's native config.
 * These types describe the loader's output only -- nothing here is written to
 * disk verbatim.
 */

export type PluginDiagnosticSeverity = 'error' | 'warning';

/**
 * A report about something the loader could not use.
 *
 * Non-fatal by construction: a diagnostic on an `AgentPlugin` means the plugin
 * loaded with that component skipped (§11.3.4 -- clients SHOULD report). A
 * diagnostic on a rejected `PluginLoadResult` explains the rejection.
 */
export interface PluginDiagnostic {
  severity: PluginDiagnosticSeverity;
  /** Spec section that governs, e.g. '5.2', '7.2.2'. */
  section: string;
  message: string;
  /** Component this concerns, when scoped: skill dir name or mcp server name. */
  subject?: string;
}

/**
 * The closed set of `plugin.json` fields (§5.2).
 *
 * Metadata fields are validated by JSON type only (§5.4): `version` need not be
 * semver, `homepage` need not parse as a URL, `license` need not be SPDX.
 */
export interface PluginManifest {
  $schema: string;
  name: string;
  version?: string;
  description?: string;
  author?: { name?: string; email?: string; url?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  extensions?: Record<string, Record<string, unknown>>;
}

/**
 * One skill discovered under `skills/` (§7.1).
 */
export interface PluginSkill {
  /** Directory name under skills/ -- the immediate child. */
  name: string;
  /** Absolute path to the skill directory. */
  dir: string;
  /** Absolute path to SKILL.md. */
  skillFile: string;
}

/**
 * One MCP server entry from `mcp.json` (§7.2.1), fully resolved.
 *
 * Placeholders are already expanded and plugin-relative paths are already
 * absolute: the downstream agent does not understand the portable format, so
 * the loader resolves it rather than passing it through.
 */
export type PluginMcpServer =
  | {
      name: string;
      type: 'stdio';
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    }
  | {
      name: string;
      type: 'streamable-http' | 'sse';
      url: string;
      headers?: Record<string, string>;
    };

/**
 * A loaded plugin package.
 */
export interface AgentPlugin {
  root: string;
  manifest: PluginManifest;
  skills: PluginSkill[];
  /** Empty when mcp.json is absent OR when MCP was disabled for the plugin (§7.2.2.2). */
  mcpServers: PluginMcpServer[];
  diagnostics: PluginDiagnostic[];
}

/**
 * Outcome of loading a plugin directory.
 *
 * `ok: false` is reserved for a fatal `plugin.json` problem (§5.2, §11.3.2);
 * every other failure is isolated to its component and surfaces as a
 * diagnostic on a successfully loaded plugin.
 */
export type PluginLoadResult =
  | { ok: true; plugin: AgentPlugin }
  | { ok: false; diagnostics: PluginDiagnostic[] };
