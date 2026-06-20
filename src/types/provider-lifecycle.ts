import type * as vscode from 'vscode';
import type { ConfigScope } from './enums.js';

/**
 * Platform lifecycle capability interface.
 *
 * Covers platform detection and filesystem watch path resolution.
 * These methods drive the extension's startup flow and file watcher setup.
 */
export interface LifecycleCapability {
  readonly id: string;
  readonly displayName: string;

  /**
   * When true, the agent is omitted entirely from agent-selection UI while
   * undetected (rather than shown as "not detected"). Copilot sets this
   * because it must not appear unless its VS Code extension is installed.
   * Absent/false for providers that are always listed.
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

  // ---------------------------------------------------------------------------
  // Optional provider-owned lifecycle hooks (keep provider specifics out of
  // extension.ts — see Phase 4d).
  // ---------------------------------------------------------------------------

  /**
   * Provider-specific commands to register at activation. Returned as
   * descriptors so the host owns `registerCommand` — this keeps `vscode` out of
   * the provider's import graph (it stays unit-testable); handlers run lazily at
   * invocation time and may `await import('vscode')` internally.
   */
  getCommands?(): ReadonlyArray<{ id: string; handler: () => void | Promise<void> }>;

  /**
   * Run detection-time configuration checks/notifications (the provider
   * self-gates on its own `detect()`). Called after startup detection and on
   * re-detect. `force` re-surfaces checks the user previously dismissed.
   */
  checkConfiguration?(context: vscode.ExtensionContext, force?: boolean): Promise<void>;
}
