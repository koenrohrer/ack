import type { AgentProvider } from '../types/provider.js';

/**
 * Registry for platform providers.
 *
 * Manages provider registration, lookup, and detection. Supports
 * multi-provider registration for future multi-platform support.
 *
 * The detect-and-activate flow iterates registered providers and
 * automatically activates if exactly one platform is detected.
 * If multiple platforms are detected, the caller must prompt the user.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, AgentProvider>();
  private activeId: string | undefined;

  /**
   * Register an provider. Replaces any existing provider with the same id.
   */
  register(provider: AgentProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Look up a registered provider by id.
   */
  getProvider(id: string): AgentProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Return the currently active provider, if one has been set.
   */
  getActiveProvider(): AgentProvider | undefined {
    if (!this.activeId) {
      return undefined;
    }
    return this.providers.get(this.activeId);
  }

  /**
   * Set the active provider by id.
   * Throws if the provider is not registered.
   */
  setActiveProvider(id: string): void {
    if (!this.providers.has(id)) {
      throw new Error(
        `Provider "${id}" is not registered. Available: ${[...this.providers.keys()].join(', ')}`,
      );
    }
    this.activeId = id;
  }

  /**
   * Detect available platforms and activate if exactly one is found.
   *
   * Iterates all registered providers and calls detect() on each.
   * - If exactly one returns true, activates it and returns it.
   * - If multiple return true, returns undefined (caller must prompt user).
   * - If none return true, returns undefined.
   */
  async detectAndActivate(): Promise<AgentProvider | undefined> {
    const detected: AgentProvider[] = [];

    for (const provider of this.providers.values()) {
      const available = await provider.detect();
      if (available) {
        detected.push(provider);
      }
    }

    if (detected.length === 1) {
      this.activeId = detected[0].id;
      return detected[0];
    }

    return undefined;
  }

  /**
   * Return all registered providers.
   */
  getAllProviders(): AgentProvider[] {
    return [...this.providers.values()];
  }
}
