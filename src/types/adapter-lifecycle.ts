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
   * Detect whether this platform is available on the current system.
   */
  detect(): Promise<boolean>;

  /**
   * Return filesystem paths that should be watched for changes in a scope.
   */
  getWatchPaths(scope: ConfigScope): string[];
}
