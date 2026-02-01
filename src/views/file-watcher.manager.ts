import * as vscode from 'vscode';
import type { IPlatformAdapter } from '../types/adapter.js';
import { collectWatchDirs } from './file-watcher.utils.js';

/**
 * Manages file system watchers for config change detection.
 *
 * Watches all config file directories reported by the active platform adapter,
 * using vscode.RelativePattern for paths outside the workspace (required for
 * external directory watching -- plain string globs do not work).
 *
 * Rapid successive changes are coalesced into a single refresh via debouncing.
 * After refresh, an optional notification callback is invoked (controlled by
 * the agentConfigKeeper.showChangeNotifications setting in extension.ts).
 */
export class FileWatcherManager implements vscode.Disposable {
  private watchers: vscode.FileSystemWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  readonly DEBOUNCE_MS = 500;

  constructor(
    private readonly onRefresh: () => void,
    private readonly onNotify: () => void,
  ) {}

  /**
   * Set up file watchers for all config directories from the adapter.
   *
   * Disposes any existing watchers first, then creates new ones for
   * each unique directory. Uses RelativePattern with Uri.file() to
   * support paths outside the workspace.
   */
  setupWatchers(adapter: IPlatformAdapter): void {
    this.disposeWatchers();

    const dirs = collectWatchDirs(adapter);

    for (const { dir, recursive } of dirs) {
      const base = vscode.Uri.file(dir);
      const globPattern = recursive ? '**/*' : '*';
      const pattern = new vscode.RelativePattern(base, globPattern);

      const watcher = vscode.workspace.createFileSystemWatcher(pattern);

      watcher.onDidChange(() => this.handleChange());
      watcher.onDidCreate(() => this.handleChange());
      watcher.onDidDelete(() => this.handleChange());

      this.watchers.push(watcher);
    }
  }

  /**
   * Handle a file change event with debouncing.
   *
   * Clears any pending timer and starts a new one. When the timer fires,
   * calls onRefresh first, then onNotify. This naturally coalesces rapid
   * successive changes (including double-fire from external watchers)
   * into a single refresh + notification.
   */
  handleChange(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.onRefresh();
      this.onNotify();
    }, this.DEBOUNCE_MS);
  }

  private disposeWatchers(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];
  }

  dispose(): void {
    this.disposeWatchers();
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }
}
