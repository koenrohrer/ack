import { z } from 'zod';

// ---------------------------------------------------------------------------
// Profile data model types
// ---------------------------------------------------------------------------

/**
 * A single tool entry within a profile.
 *
 * Stores the canonical key and the desired enabled/disabled state.
 * Keys use the shared canonical format from tool-key.utils.ts:
 * - `"type:name"` for most tools (e.g., `"mcp_server:github"`)
 * - `"hook:eventName:matcher"` for hooks
 */
export interface ProfileToolEntry {
  /** Canonical key identifying the tool (e.g., "mcp_server:github") */
  key: string;
  /** Whether this tool should be enabled when the profile is active */
  enabled: boolean;
}

/**
 * A named profile -- a preset collection of tool states.
 *
 * Profiles store canonical tool keys and desired states, not raw config.
 * This keeps profiles lightweight and avoids duplication with config files.
 */
export interface Profile {
  /** Unique identifier (UUID) */
  id: string;
  /** User-visible name */
  name: string;
  /** Tool states in this profile */
  tools: ProfileToolEntry[];
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last modification */
  updatedAt: string;
}

/**
 * Top-level structure stored in globalState.
 *
 * Contains all saved profiles and tracks which one is currently active.
 */
export interface ProfileStore {
  /** All saved profiles */
  profiles: Profile[];
  /** ID of the active profile, or null for "no profile" (current environment) */
  activeProfileId: string | null;
}

// ---------------------------------------------------------------------------
// Zod validation schemas
// ---------------------------------------------------------------------------

export const ProfileToolEntrySchema = z.object({
  key: z.string(),
  enabled: z.boolean(),
});

export const ProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  tools: z.array(ProfileToolEntrySchema),
  createdAt: z.string(),
  updatedAt: z.string(),
}).passthrough();

/**
 * Zod schema for the profile store.
 *
 * Uses `.passthrough()` for forward compatibility -- if future versions add
 * new fields, existing stored data won't fail validation (project convention
 * from 01-02 decision).
 */
export const ProfileStoreSchema = z.object({
  profiles: z.array(ProfileSchema),
  activeProfileId: z.string().nullable(),
}).passthrough();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** globalState storage key for profile data */
export const PROFILE_STORE_KEY = 'agent-config-keeper.profiles';

/** Default empty store used when no profile data exists yet */
export const DEFAULT_PROFILE_STORE: ProfileStore = {
  profiles: [],
  activeProfileId: null,
};
