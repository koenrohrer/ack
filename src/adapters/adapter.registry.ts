import type { IPlatformAdapter } from '../types/adapter.js';

/**
 * Registry for platform adapters.
 *
 * Manages adapter registration, lookup, and detection. Supports
 * multi-adapter registration for future multi-platform support.
 *
 * The detect-and-activate flow iterates registered adapters and
 * automatically activates if exactly one platform is detected.
 * If multiple platforms are detected, the caller must prompt the user.
 */
export class AdapterRegistry {
  private readonly adapters = new Map<string, IPlatformAdapter>();
  private activeId: string | undefined;

  /**
   * Register an adapter. Replaces any existing adapter with the same id.
   */
  register(adapter: IPlatformAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  /**
   * Look up a registered adapter by id.
   */
  getAdapter(id: string): IPlatformAdapter | undefined {
    return this.adapters.get(id);
  }

  /**
   * Return the currently active adapter, if one has been set.
   */
  getActiveAdapter(): IPlatformAdapter | undefined {
    if (!this.activeId) {
      return undefined;
    }
    return this.adapters.get(this.activeId);
  }

  /**
   * Set the active adapter by id.
   * Throws if the adapter is not registered.
   */
  setActiveAdapter(id: string): void {
    if (!this.adapters.has(id)) {
      throw new Error(
        `Adapter "${id}" is not registered. Available: ${[...this.adapters.keys()].join(', ')}`,
      );
    }
    this.activeId = id;
  }

  /**
   * Detect available platforms and activate if exactly one is found.
   *
   * Iterates all registered adapters and calls detect() on each.
   * - If exactly one returns true, activates it and returns it.
   * - If multiple return true, returns undefined (caller must prompt user).
   * - If none return true, returns undefined.
   */
  async detectAndActivate(): Promise<IPlatformAdapter | undefined> {
    const detected: IPlatformAdapter[] = [];

    for (const adapter of this.adapters.values()) {
      const available = await adapter.detect();
      if (available) {
        detected.push(adapter);
      }
    }

    if (detected.length === 1) {
      this.activeId = detected[0].id;
      return detected[0];
    }

    return undefined;
  }

  /**
   * Return all registered adapters.
   */
  getAllAdapters(): IPlatformAdapter[] {
    return [...this.adapters.values()];
  }
}
