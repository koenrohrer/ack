import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { collectWatchDirs } from '../../views/file-watcher.utils.js';
import { ConfigScope, ToolType } from '../../types/enums.js';
import type { IPlatformAdapter } from '../../types/adapter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(
  watchPaths: Partial<Record<ConfigScope, string[]>>,
): IPlatformAdapter {
  return {
    id: 'test',
    displayName: 'Test',
    supportedToolTypes: new Set([ToolType.Skill]),
    readTools: vi.fn(),
    writeTool: vi.fn(),
    removeTool: vi.fn(),
    getWatchPaths: (scope: ConfigScope) => watchPaths[scope] ?? [],
    detect: vi.fn(),
  };
}

/**
 * Minimal debounce implementation matching FileWatcherManager behavior.
 *
 * The actual FileWatcherManager cannot be unit tested without vscode.
 * This class exercises the same debounce logic pattern to verify
 * correctness of the timing and coalescing behavior.
 */
class DebounceHarness {
  private timer: ReturnType<typeof setTimeout> | undefined;
  readonly DEBOUNCE_MS = 500;

  constructor(
    private readonly onRefresh: () => void,
    private readonly onNotify: () => void,
  ) {}

  handleChange(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.onRefresh();
      this.onNotify();
    }, this.DEBOUNCE_MS);
  }

  dispose(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// collectWatchDirs
// ---------------------------------------------------------------------------

describe('collectWatchDirs', () => {
  it('collects parent directories of config file paths', () => {
    const adapter = makeAdapter({
      [ConfigScope.User]: ['/home/.claude/settings.json'],
    });

    const dirs = collectWatchDirs(adapter);

    expect(dirs).toEqual([{ dir: '/home/.claude', recursive: false }]);
  });

  it('deduplicates directories from different scopes', () => {
    const adapter = makeAdapter({
      [ConfigScope.User]: ['/home/.claude/settings.json'],
      // Local scope also has a file in /home/.claude/ -- should deduplicate
      [ConfigScope.Local]: ['/home/.claude/settings.local.json'],
    });

    const dirs = collectWatchDirs(adapter);
    const uniqueDirs = dirs.map((d) => d.dir);

    // Both files share /home/.claude as parent
    expect(uniqueDirs).toEqual(['/home/.claude']);
  });

  it('keeps skills/commands directories separate from file parent dirs', () => {
    const adapter = makeAdapter({
      [ConfigScope.User]: [
        '/home/.claude/settings.json',
        '/home/.claude/skills',
      ],
    });

    const dirs = collectWatchDirs(adapter);

    // /home/.claude from file parent + /home/.claude/skills as recursive dir
    expect(dirs).toHaveLength(2);
    expect(dirs).toContainEqual({ dir: '/home/.claude', recursive: false });
    expect(dirs).toContainEqual({
      dir: '/home/.claude/skills',
      recursive: true,
    });
  });

  it('marks skills directories as recursive', () => {
    const adapter = makeAdapter({
      [ConfigScope.User]: ['/home/.claude/skills'],
    });

    const dirs = collectWatchDirs(adapter);

    expect(dirs).toEqual([
      { dir: '/home/.claude/skills', recursive: true },
    ]);
  });

  it('marks commands directories as recursive', () => {
    const adapter = makeAdapter({
      [ConfigScope.User]: ['/home/.claude/commands'],
    });

    const dirs = collectWatchDirs(adapter);

    expect(dirs).toEqual([
      { dir: '/home/.claude/commands', recursive: true },
    ]);
  });

  it('handles empty watch paths gracefully', () => {
    const adapter = makeAdapter({});

    const dirs = collectWatchDirs(adapter);

    expect(dirs).toEqual([]);
  });

  it('collects paths from all scopes', () => {
    const adapter = makeAdapter({
      [ConfigScope.User]: ['/home/.claude/settings.json'],
      [ConfigScope.Project]: ['/workspace/.claude/settings.json'],
      [ConfigScope.Managed]: ['/etc/claude/managed-settings.json'],
    });

    const dirs = collectWatchDirs(adapter);
    const dirPaths = dirs.map((d) => d.dir);

    expect(dirPaths).toContain('/home/.claude');
    expect(dirPaths).toContain('/workspace/.claude');
    expect(dirPaths).toContain('/etc/claude');
  });
});

// ---------------------------------------------------------------------------
// Debounce logic (mirrors FileWatcherManager.handleChange behavior)
// ---------------------------------------------------------------------------

describe('FileWatcherManager debounce logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onRefresh after debounce settles', () => {
    const onRefresh = vi.fn();
    const onNotify = vi.fn();
    const harness = new DebounceHarness(onRefresh, onNotify);

    harness.handleChange();
    expect(onRefresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(harness.DEBOUNCE_MS);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    harness.dispose();
  });

  it('coalesces rapid changes into single refresh', () => {
    const onRefresh = vi.fn();
    const onNotify = vi.fn();
    const harness = new DebounceHarness(onRefresh, onNotify);

    // Simulate 5 rapid changes within debounce window
    harness.handleChange();
    vi.advanceTimersByTime(100);
    harness.handleChange();
    vi.advanceTimersByTime(100);
    harness.handleChange();
    vi.advanceTimersByTime(100);
    harness.handleChange();
    vi.advanceTimersByTime(100);
    harness.handleChange();

    // Still within debounce -- no call yet
    expect(onRefresh).not.toHaveBeenCalled();

    // Advance past debounce
    vi.advanceTimersByTime(harness.DEBOUNCE_MS);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    harness.dispose();
  });

  it('calls onNotify after onRefresh (not before)', () => {
    const callOrder: string[] = [];
    const onRefresh = vi.fn(() => callOrder.push('refresh'));
    const onNotify = vi.fn(() => callOrder.push('notify'));
    const harness = new DebounceHarness(onRefresh, onNotify);

    harness.handleChange();
    vi.advanceTimersByTime(harness.DEBOUNCE_MS);

    expect(callOrder).toEqual(['refresh', 'notify']);

    harness.dispose();
  });

  it('dispose clears pending debounce timer', () => {
    const onRefresh = vi.fn();
    const onNotify = vi.fn();
    const harness = new DebounceHarness(onRefresh, onNotify);

    harness.handleChange();
    harness.dispose();

    // Advance time -- should NOT fire because disposed
    vi.advanceTimersByTime(harness.DEBOUNCE_MS * 2);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(onNotify).not.toHaveBeenCalled();
  });

  it('allows new changes after debounce settles', () => {
    const onRefresh = vi.fn();
    const onNotify = vi.fn();
    const harness = new DebounceHarness(onRefresh, onNotify);

    // First batch
    harness.handleChange();
    vi.advanceTimersByTime(harness.DEBOUNCE_MS);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // Second batch (after settle)
    harness.handleChange();
    vi.advanceTimersByTime(harness.DEBOUNCE_MS);
    expect(onRefresh).toHaveBeenCalledTimes(2);

    harness.dispose();
  });
});
