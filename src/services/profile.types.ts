import { z } from 'zod';
import type { NormalizedTool } from '../types/config.js';

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
  /** Agent this profile belongs to (e.g., 'claude-code', 'codex') */
  agentId?: string;
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
  /** Schema version for migration gating (v1 implicit for stores without version) */
  version?: number;
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
  agentId: z.string().optional(),
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
  version: z.number().optional(),
  profiles: z.array(ProfileSchema),
  activeProfileId: z.string().nullable(),
}).passthrough();

// ---------------------------------------------------------------------------
// Switch result types
// ---------------------------------------------------------------------------

/**
 * Result of a profile switch operation.
 *
 * Tracks how many tools were toggled, how many profile entries had no
 * matching tool in the current environment (silently skipped), and any
 * toggle failures with error details.
 */
export interface SwitchResult {
  success: boolean;
  toggled: number;
  skipped: number;
  failed: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Export/import types
// ---------------------------------------------------------------------------

/**
 * Discriminated union describing the configuration for an exported tool.
 *
 * Each variant captures the full config data so the bundle is self-contained
 * and works on machines that don't have the same tools pre-installed.
 */
export type ExportedToolConfig =
  | { kind: 'mcp_server'; command: string; args: string[]; env: Record<string, string>; transport?: string; url?: string }
  | { kind: 'skill'; files: { name: string; content: string }[] }
  | { kind: 'command'; files: { name: string; content: string }[] }
  | { kind: 'hook'; eventName: string; matcher: string; hooks: Array<Record<string, unknown>> }
  | { kind: 'custom_prompt'; files: { name: string; content: string }[] };

/**
 * A single tool within an export bundle.
 */
export interface ExportedTool {
  key: string;
  enabled: boolean;
  type: 'skill' | 'mcp_server' | 'hook' | 'command' | 'custom_prompt';
  name: string;
  config: ExportedToolConfig;
}

/**
 * Self-contained profile export bundle.
 *
 * Contains full tool configuration data so profiles can be shared across
 * machines and projects without requiring pre-installed tools.
 *
 * v2 bundles include version and agentId for cross-machine portability
 * and agent-aware import conversion.
 */
export interface ProfileExportBundle {
  bundleType: 'ack-profile';
  /** Bundle format version (2 for agent-aware bundles) */
  version: number;
  /** Agent this profile was created for (e.g., 'claude-code', 'codex') */
  agentId: string;
  profile: {
    name: string;
    createdAt: string;
    updatedAt: string;
    exportedAt: string;
  };
  tools: ExportedTool[];
}

/**
 * Analysis of an import bundle against the local tool environment.
 *
 * Classifies each bundle tool as matching (identical config), conflicting
 * (same key but different config), or missing (not installed locally).
 */
export interface ImportAnalysis {
  matching: ExportedTool[];
  conflicts: Array<{ exported: ExportedTool; local: NormalizedTool }>;
  missing: ExportedTool[];
}

/**
 * Result of an import operation.
 */
export interface ImportResult {
  profileId: string;
  profileName: string;
  installed: number;
  skipped: string[];
  conflictsResolved: number;
}

// ---------------------------------------------------------------------------
// Export/import Zod schemas
// ---------------------------------------------------------------------------

const ExportedFileSchema = z.object({
  name: z.string(),
  content: z.string(),
}).passthrough();

const McpServerConfigSchema = z.object({
  kind: z.literal('mcp_server'),
  command: z.string(),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()),
  transport: z.string().optional(),
  url: z.string().optional(),
}).passthrough();

const SkillConfigSchema = z.object({
  kind: z.literal('skill'),
  files: z.array(ExportedFileSchema),
}).passthrough();

const CommandConfigSchema = z.object({
  kind: z.literal('command'),
  files: z.array(ExportedFileSchema),
}).passthrough();

const HookConfigSchema = z.object({
  kind: z.literal('hook'),
  eventName: z.string(),
  matcher: z.string(),
  hooks: z.array(z.record(z.string(), z.unknown())),
}).passthrough();

const CustomPromptConfigSchema = z.object({
  kind: z.literal('custom_prompt'),
  files: z.array(ExportedFileSchema),
}).passthrough();

export const ExportedToolConfigSchema = z.discriminatedUnion('kind', [
  McpServerConfigSchema,
  SkillConfigSchema,
  CommandConfigSchema,
  HookConfigSchema,
  CustomPromptConfigSchema,
]);

export const ExportedToolSchema = z.object({
  key: z.string(),
  enabled: z.boolean(),
  type: z.enum(['skill', 'mcp_server', 'hook', 'command', 'custom_prompt']),
  name: z.string(),
  config: ExportedToolConfigSchema,
}).passthrough();

/**
 * Zod schema for validating imported profile bundles.
 *
 * v2 bundles require version and agentId fields.
 * Uses `.passthrough()` for forward compatibility (project convention from 01-02).
 */
export const ProfileExportBundleSchema = z.object({
  bundleType: z.literal('ack-profile'),
  version: z.number(),
  agentId: z.string(),
  profile: z.object({
    name: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    exportedAt: z.string(),
  }).passthrough(),
  tools: z.array(ExportedToolSchema),
}).passthrough();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** globalState storage key for profile data */
export const PROFILE_STORE_KEY = 'ack.profiles';

/**
 * Current profile store schema version.
 *
 * v1: implicit, stores without version field (pre-agent-scoping)
 * v2: profiles have agentId field, store has version field
 */
export const PROFILE_STORE_VERSION = 2;

/**
 * Current export bundle format version.
 *
 * v1: pre-agent-scoping bundles (no version/agentId fields)
 * v2: agent-aware bundles with version and agentId
 */
export const EXPORT_BUNDLE_VERSION = 2;

/** Default empty store used when no profile data exists yet */
export const DEFAULT_PROFILE_STORE: ProfileStore = {
  version: PROFILE_STORE_VERSION,
  profiles: [],
  activeProfileId: null,
};
