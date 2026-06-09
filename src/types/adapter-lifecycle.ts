import type { ConfigScope } from './enums.js';

/**
 * Platform lifecycle capability interface.
 *
 * Covers platform detection and filesystem watch path resolution.
 * These methods drive the extension's startup flow and file watcher setup.
 */
export interface ILifecycleAdapter {
  readonly id: string;
  readonly displayName: string;

  /**
   * When true, the agent is omitted entirely from agent-selection UI while
   * undetected (rather than shown as "not detected"). Copilot sets this
   * because it must not appear unless its VS Code extension is installed.
   * Absent/false for adapters that are always listed.
   */
  readonly hideWhenUndetected?: boolean;

  /**
   * Detect whether this platform is available on the current system.
   */
  detect(): Promise<boolean>;

  /**
   * Return filesystem paths that should be watched for changes in a scope.
   */
  getWatchPaths(scope: ConfigScope): string[];
}
