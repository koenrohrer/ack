import * as path from 'path';
import type { ConfigScope } from '../types/enums.js';
import type { AgentPlugin, PluginDiagnostic } from '../types/plugin.js';
import type { AgentProvider } from '../types/provider.js';
import { readSkillTree } from './plugin.files.js';
import { entryExists } from './plugin.paths.js';
import type { InstalledPluginRecord, PluginStore } from './plugin.store.js';
import { installedServerName, toNativeMcpServer } from './plugin.translate.js';

/**
 * Installing a plugin package and fanning its components out into the active
 * agent's live configuration, Agent Plugins 1.0.0 §7.1 / §7.2.2 / §9.1 / §11.3.
 *
 * The store runs first and completely: `PluginStore.install` validates the
 * source, copies it in, and re-loads it from the installed location. Only then
 * does anything reach a provider. A fatally invalid package (§11.3.2) therefore
 * rejects with nothing written to any agent.
 *
 * Every write seam is wrapped per entry (§11.3.3): one skill that cannot be
 * written, or one server the agent cannot express, must cost that component and
 * nothing else. Each skip carries the underlying cause, because §11.3.4's
 * "SHOULD report" is worth nothing to a user reading "install failed".
 *
 * No `vscode`: the caller owns the UI, supplies the scope, and supplies the
 * overwrite confirmer. That keeps this whole path exercisable outside the
 * extension host, which is where the §9.1 and §E guarantees are pinned.
 */

/** One component that was not installed, and why. */
interface SkipReport {
  name: string;
  reason: string;
}

/** What one install did, component by component. */
export interface PluginFanoutResult {
  record: InstalledPluginRecord;
  /** The INSTALLED copy -- store-rooted, never the source (§E). */
  plugin: AgentPlugin;
  installedSkills: string[];
  skippedSkills: SkipReport[];
  /** Both names of each written server: portable (§7.2.1) and namespaced (§A3). */
  installedServers: Array<{ portable: string; installed: string }>;
  /** Identified by the PORTABLE name -- see `fanOutServers`. */
  skippedServers: SkipReport[];
  diagnostics: PluginDiagnostic[];
}

/**
 * Asks the user whether to overwrite an existing component.
 *
 * Only ever called for a skill: MCP servers are namespaced per §A3, so a
 * collision there can only be this same plugin overwriting its own previous
 * install, which is the correct outcome and not a question worth asking.
 */
export type OverwriteConfirmer = (kind: 'skill', name: string) => Promise<boolean>;

export class PluginInstallService {
  constructor(private readonly store: PluginStore) {}

  /**
   * Install the package at `sourceDir` and write its components into `provider`
   * at `scope`.
   *
   * Rejects only when the store rejects -- a fatal package, or a copy that no
   * longer loads. Every per-component outcome is reported in the result.
   */
  async install(
    sourceDir: string,
    provider: AgentProvider,
    scope: ConfigScope,
    confirmOverwrite: OverwriteConfirmer,
  ): Promise<PluginFanoutResult> {
    // Store first, and its SECOND load is what fans out (§E). The store loads
    // the plugin twice on purpose: once against `sourceDir` to validate, then
    // again against the installed copy. The loader fully resolves as it goes --
    // `./` commands, `cwd`, and the §9.2 `${PLUGIN_ROOT}`/`${PLUGIN_DATA}` pass
    // -- against whatever root it was handed, so the first load's paths all
    // point at the user's source directory. Collapsing this back into one load
    // would write an agent config referencing a tree the user may move or
    // delete, which is the entire reason the managed store exists.
    const { record, plugin } = await this.store.install(sourceDir);

    const skills = await fanOutSkills(plugin, provider, scope, confirmOverwrite);
    const servers = await fanOutServers(plugin, record, provider, scope);

    return {
      record,
      plugin,
      ...skills,
      ...servers,
      // Copied, so a caller cannot mutate the loaded plugin's own list. The
      // fan-out's own outcomes are reported through the typed skip arrays
      // above rather than duplicated here.
      diagnostics: [...plugin.diagnostics],
    };
  }
}

// ---------------------------------------------------------------------------
// Skills (§7.1, §A5)
// ---------------------------------------------------------------------------

async function fanOutSkills(
  plugin: AgentPlugin,
  provider: AgentProvider,
  scope: ConfigScope,
  confirmOverwrite: OverwriteConfirmer,
): Promise<Pick<PluginFanoutResult, 'installedSkills' | 'skippedSkills'>> {
  const installedSkills: string[] = [];
  const skippedSkills: SkipReport[] = [];

  if (plugin.skills.length === 0) {
    return { installedSkills, skippedSkills };
  }

  // Capability, never identity. Whether this agent can host a directory-shaped
  // skill in this scope is exactly whether it can name a directory to put one
  // in, so the probe is the question. Copilot is the provider §A5 was written
  // for, but branching on its id would be wrong in both directions: for the
  // next provider that also cannot, and for a Copilot that one day can.
  let skillsDir: string;
  try {
    skillsDir = provider.getSkillsDir(scope);
  } catch (error) {
    // §A5 / §11.3.3: the skills component type is skipped, with a reason, and
    // the plugin's MCP servers still install.
    const reason = `this agent has no skills directory for this scope: ${describeError(error)}`;
    for (const skill of plugin.skills) {
      skippedSkills.push({ name: skill.name, reason });
    }
    return { installedSkills, skippedSkills };
  }

  for (const skill of plugin.skills) {
    // §11.3.3: each skill is its own failure boundary. `installSkill` writes
    // through `writeSkillTree`, which throws on a file name that escapes the
    // skill directory -- an untrusted package must cost that one skill, not
    // abort the install of everything else it ships.
    try {
      // Skills are not namespaced (§D): `deploy` from this plugin and `deploy`
      // from anywhere else land on the same directory, so a collision is a
      // question only the user can answer.
      if (await entryExists(path.join(skillsDir, skill.name))) {
        if (!(await confirmOverwrite('skill', skill.name))) {
          skippedSkills.push({
            name: skill.name,
            reason: 'a skill of that name is already installed and overwriting it was declined.',
          });
          continue;
        }
      }

      await provider.installSkill(scope, skill.name, await readSkillTree(skill.dir));
      installedSkills.push(skill.name);
    } catch (error) {
      // §11.3.4: the cause, not just the fact. "install failed" is not a report
      // anyone can act on.
      skippedSkills.push({ name: skill.name, reason: `it could not be installed: ${describeError(error)}` });
    }
  }

  return { installedSkills, skippedSkills };
}

// ---------------------------------------------------------------------------
// MCP servers (§7.2.2, §9.1, §A3)
// ---------------------------------------------------------------------------

async function fanOutServers(
  plugin: AgentPlugin,
  record: InstalledPluginRecord,
  provider: AgentProvider,
  scope: ConfigScope,
): Promise<Pick<PluginFanoutResult, 'installedServers' | 'skippedServers'>> {
  const installedServers: PluginFanoutResult['installedServers'] = [];
  const skippedServers: SkipReport[] = [];

  const transport = provider.getMcpTransportSupport();

  for (const server of plugin.mcpServers) {
    // §9.1's two reserved names, as the loader itself used them: `plugin.root`
    // is the root every `${PLUGIN_ROOT}` in this server was already expanded
    // against, and `record.dataDir` is the `pluginData` the store passed in.
    // Taking them from anywhere else would let the env disagree with the args.
    const translated = toNativeMcpServer(
      server,
      { pluginRoot: plugin.root, pluginData: record.dataDir },
      transport,
    );

    // §7.2.2.4: a transport this agent cannot express skips the server, and
    // only the server.
    if (!translated.ok) {
      skippedServers.push({ name: server.name, reason: translated.reason });
      continue;
    }

    const installed = installedServerName(plugin.manifest.name, server.name);
    try {
      await provider.installMcpServer(scope, installed, translated.config);
      installedServers.push({ portable: server.name, installed });
    } catch (error) {
      // §11.3.3 again, and the skip is recorded under the PORTABLE name: that
      // is what the plugin's own `mcp.json` calls this server, so it is the
      // name a user reading the report can actually go and find.
      skippedServers.push({
        name: server.name,
        reason: `it could not be written to this agent's MCP configuration: ${describeError(error)}`,
      });
    }
  }

  return { installedServers, skippedServers };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
