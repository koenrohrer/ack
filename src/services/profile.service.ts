import * as crypto from 'crypto';
import type * as vscode from 'vscode';
import type { ConfigService } from './config.service.js';
import { ToolType, ConfigScope, ToolStatus } from '../types/enums.js';
import { canonicalKey } from '../utils/tool-key.utils.js';
import {
  PROFILE_STORE_KEY,
  DEFAULT_PROFILE_STORE,
  ProfileStoreSchema,
} from './profile.types.js';
import type { Profile, ProfileToolEntry, ProfileStore } from './profile.types.js';

/**
 * Manages named profiles -- preset collections of tool enabled/disabled states.
 *
 * Provides full CRUD operations over profiles stored in VS Code globalState.
 * Profiles are lightweight snapshots: they store canonical tool keys and
 * desired states, not raw config data.
 *
 * Persistence follows a load-mutate-save pattern with no in-memory caching.
 * Every read goes through globalState to ensure consistency, and every write
 * validates the store with Zod before persisting.
 *
 * Accepts a Memento (not full ExtensionContext) for testability.
 */
export class ProfileService {
  constructor(
    private readonly globalState: vscode.Memento,
    private readonly configService: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // Read operations
  // ---------------------------------------------------------------------------

  /**
   * Get all saved profiles.
   */
  getProfiles(): Profile[] {
    return this.loadStore().profiles;
  }

  /**
   * Get the ID of the currently active profile, or null if none.
   */
  getActiveProfileId(): string | null {
    return this.loadStore().activeProfileId;
  }

  /**
   * Get a single profile by ID.
   *
   * Returns undefined if the profile does not exist.
   */
  getProfile(id: string): Profile | undefined {
    return this.loadStore().profiles.find((p) => p.id === id);
  }

  // ---------------------------------------------------------------------------
  // Write operations
  // ---------------------------------------------------------------------------

  /**
   * Create a new profile by snapshotting the current tool inventory.
   *
   * Reads all tools across every type (Skill, McpServer, Hook, Command),
   * filters out managed-scope tools, and maps each to a ProfileToolEntry
   * with its canonical key and current enabled/disabled state.
   */
  async createProfile(name: string): Promise<Profile> {
    const entries: ProfileToolEntry[] = [];

    for (const type of [ToolType.Skill, ToolType.McpServer, ToolType.Hook, ToolType.Command]) {
      const tools = await this.configService.readAllTools(type);
      for (const tool of tools) {
        if (tool.scope === ConfigScope.Managed) {
          continue;
        }
        entries.push({
          key: canonicalKey(tool),
          enabled: tool.status === ToolStatus.Enabled,
        });
      }
    }

    const now = new Date().toISOString();
    const profile: Profile = {
      id: crypto.randomUUID(),
      name,
      tools: entries,
      createdAt: now,
      updatedAt: now,
    };

    const store = this.loadStore();
    store.profiles.push(profile);
    await this.saveStore(store);

    return profile;
  }

  /**
   * Update an existing profile with partial changes.
   *
   * Accepts optional name and/or tools updates. Sets updatedAt to now.
   * Returns the updated profile, or undefined if the profile was not found.
   */
  async updateProfile(
    id: string,
    updates: { name?: string; tools?: ProfileToolEntry[] },
  ): Promise<Profile | undefined> {
    const store = this.loadStore();
    const index = store.profiles.findIndex((p) => p.id === id);
    if (index === -1) {
      return undefined;
    }

    const profile = store.profiles[index];
    if (updates.name !== undefined) {
      profile.name = updates.name;
    }
    if (updates.tools !== undefined) {
      profile.tools = updates.tools;
    }
    profile.updatedAt = new Date().toISOString();

    store.profiles[index] = profile;
    await this.saveStore(store);

    return profile;
  }

  /**
   * Delete a profile by ID.
   *
   * If the deleted profile was the active one, clears activeProfileId to null.
   * Returns true if the profile was found and deleted, false otherwise.
   */
  async deleteProfile(id: string): Promise<boolean> {
    const store = this.loadStore();
    const index = store.profiles.findIndex((p) => p.id === id);
    if (index === -1) {
      return false;
    }

    store.profiles.splice(index, 1);

    if (store.activeProfileId === id) {
      store.activeProfileId = null;
    }

    await this.saveStore(store);
    return true;
  }

  /**
   * Set the active profile ID.
   *
   * Pass null to clear the active profile (return to "current environment").
   * If a non-null ID is provided, validates that the profile exists and
   * throws if not found.
   */
  async setActiveProfileId(id: string | null): Promise<void> {
    const store = this.loadStore();

    if (id !== null) {
      const exists = store.profiles.some((p) => p.id === id);
      if (!exists) {
        throw new Error(`Profile not found: ${id}`);
      }
    }

    store.activeProfileId = id;
    await this.saveStore(store);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Load the profile store from globalState with Zod validation.
   *
   * If stored data fails validation (corrupt state), returns the default
   * empty store to prevent crashes. This is defensive -- corrupt data
   * should not block the extension from functioning.
   */
  private loadStore(): ProfileStore {
    const raw = this.globalState.get<ProfileStore>(
      PROFILE_STORE_KEY,
      DEFAULT_PROFILE_STORE,
    );

    const result = ProfileStoreSchema.safeParse(raw);
    if (!result.success) {
      return { ...DEFAULT_PROFILE_STORE };
    }

    return result.data as ProfileStore;
  }

  /**
   * Persist the profile store to globalState.
   */
  private async saveStore(store: ProfileStore): Promise<void> {
    await this.globalState.update(PROFILE_STORE_KEY, store);
  }
}
