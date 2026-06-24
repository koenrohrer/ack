import * as path from 'path';
import { getHomeDir, getPlatform } from '../../utils/platform.js';

/**
 * Centralized file path constants for all Hermes configuration files.
 *
 * ALL Hermes file paths must come from this module. No other module
 * should construct paths to Hermes config files directly.
 *
 * Hermes keeps all config in a single user dir (~/.hermes by default,
 * $HERMES_HOME override, %LOCALAPPDATA%\hermes on Windows) plus a read-only
 * managed dir (/etc/hermes default, $HERMES_MANAGED_DIR override). Config is a
 * single config.yaml; MCP servers live under its top-level `mcp_servers` map.
 *
 * NOTE: the Windows/macOS managed-dir default is unverified -- only the Linux
 * /etc/hermes default and the HERMES_MANAGED_DIR override are confirmed from
 * source.
 */
export const HermesPaths = {
  // ---------------------------------------------------------------------------
  // Home directory resolution (env overrides honored)
  // ---------------------------------------------------------------------------

  /**
   * Resolved Hermes home directory: $HERMES_HOME if set, otherwise
   * %LOCALAPPDATA%\hermes on Windows or ~/.hermes elsewhere.
   */
  get home(): string {
    const override = process.env.HERMES_HOME?.trim();
    if (override) return override;
    return getPlatform() === 'win32'
      ? path.join(process.env.LOCALAPPDATA ?? path.join(getHomeDir(), 'AppData', 'Local'), 'hermes')
      : path.join(getHomeDir(), '.hermes');
  },

  // ---------------------------------------------------------------------------
  // User scope (based on the resolved home directory)
  // ---------------------------------------------------------------------------

  /** ~/.hermes/ directory (for detection) */
  get userHermesDir(): string {
    return this.home;
  },

  /** ~/.hermes/config.yaml */
  get userConfigYaml(): string {
    return path.join(this.home, 'config.yaml');
  },

  /** ~/.hermes/skills/ */
  get userSkillsDir(): string {
    return path.join(this.home, 'skills');
  },

  /** ~/.hermes/SOUL.md */
  get userSoulMd(): string {
    return path.join(this.home, 'SOUL.md');
  },

  // ---------------------------------------------------------------------------
  // Managed scope (read-only; /etc/hermes default, $HERMES_MANAGED_DIR override)
  // ---------------------------------------------------------------------------

  /** Managed config directory (/etc/hermes default) */
  get managedDir(): string {
    return process.env.HERMES_MANAGED_DIR?.trim() || '/etc/hermes';
  },

  /** {managedDir}/config.yaml */
  get managedConfigYaml(): string {
    return path.join(this.managedDir, 'config.yaml');
  },
} as const;
