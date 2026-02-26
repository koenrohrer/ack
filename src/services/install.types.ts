import { z } from 'zod';
import type { ConfigScope } from '../types/enums.js';
import type { RegistrySource } from './registry.types.js';

// ---------------------------------------------------------------------------
// Tool manifest types -- the shape of a tool's manifest.json in the registry
// ---------------------------------------------------------------------------

/**
 * Definition for an environment variable field in an MCP server manifest.
 *
 * Describes whether the field is required, sensitive (password-style display),
 * and provides optional description and default value for the config form.
 */
export interface EnvFieldDef {
  required: boolean;
  sensitive: boolean;
  description?: string;
  defaultValue?: string;
}

/**
 * A configuration field to present in the webview install form.
 *
 * Derived from manifest env vars or explicit configFields entries.
 * Controls the form field rendering (label, required indicator, password mode).
 */
export interface ConfigField {
  key: string;
  label: string;
  required: boolean;
  sensitive: boolean;
  description?: string;
  defaultValue?: string;
}

/**
 * The shape of a tool's manifest.json in the registry.
 *
 * Each tool in the registry has a manifest.json at its contentPath that
 * declares the tool type, runtime requirements, file structure, and
 * configuration schema needed for installation.
 */
export interface ToolManifest {
  type: 'skill' | 'mcp_server' | 'hook' | 'command' | 'custom_prompt';
  name: string;
  version: string;
  description?: string;
  /** Runtime requirement for MCP servers (e.g., 'node', 'python', 'npx', 'uvx'). */
  runtime?: string;
  /** For skills/commands: list of files to download (e.g., ['SKILL.md']). */
  files?: string[];
  config: {
    /** MCP server command. */
    command?: string;
    /** MCP server args. */
    args?: string[];
    /** MCP server env vars with field definitions. */
    env?: Record<string, EnvFieldDef>;
    /** Hook event name. */
    event?: string;
    /** Hook matcher pattern. */
    matcher?: string;
    /** Hook definitions. */
    hooks?: Array<Record<string, unknown>>;
  };
  /** Fields to prompt user for in the config form. */
  configFields?: ConfigField[];
}

// ---------------------------------------------------------------------------
// Install request / result types
// ---------------------------------------------------------------------------

/**
 * Request object passed to InstallService.install().
 *
 * Contains everything needed to install a tool: the validated manifest,
 * target scope, registry source for content fetching, content path for
 * file downloads, and user-provided config values.
 */
export interface InstallRequest {
  manifest: ToolManifest;
  scope: ConfigScope;
  source: RegistrySource;
  contentPath: string;
  /** User-provided configuration values from the config form. */
  configValues?: Record<string, string>;
  /** Preserved user customizations on update (existing env values). */
  existingEnvValues?: Record<string, string>;
}

/**
 * Result of an install operation.
 */
export interface InstallResult {
  success: boolean;
  error?: string;
  toolName: string;
  scope: ConfigScope;
}

/**
 * Result of a runtime availability check.
 */
export interface RuntimeCheckResult {
  available: boolean;
  version?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Path safety validators
// ---------------------------------------------------------------------------

/** Reject path traversal sequences and unsafe characters in names/filenames. */
const safeNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (s) =>
      !s.includes('..') &&
      !s.includes('\0') &&
      !s.startsWith('/') &&
      !s.startsWith('\\') &&
      !/[<>:"|?*]/.test(s),
    { message: 'Name contains unsafe path characters' },
  );

/** Reject traversal in file paths (allows forward slashes for subdirectories). */
const safeFilePathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (s) =>
      !s.includes('..') &&
      !s.includes('\0') &&
      !s.startsWith('/') &&
      !s.startsWith('\\') &&
      !/[<>:"|?*]/.test(s),
    { message: 'File path contains unsafe characters' },
  );

// ---------------------------------------------------------------------------
// Zod manifest validation schema
// ---------------------------------------------------------------------------

const EnvFieldDefSchema = z.object({
  required: z.boolean(),
  sensitive: z.boolean(),
  description: z.string().optional(),
  defaultValue: z.string().optional(),
}).passthrough();

const ConfigFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  required: z.boolean(),
  sensitive: z.boolean(),
  description: z.string().optional(),
  defaultValue: z.string().optional(),
}).passthrough();

const ManifestConfigSchema = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), EnvFieldDefSchema).optional(),
  event: z.string().optional(),
  matcher: z.string().optional(),
  hooks: z.array(z.record(z.string(), z.unknown())).optional(),
}).passthrough();

/**
 * Zod schema for validating fetched tool manifests.
 *
 * Uses `.passthrough()` on the top-level object to preserve unknown fields,
 * following project convention (01-02 decision).
 */
export const ToolManifestSchema = z.object({
  type: z.enum(['skill', 'mcp_server', 'hook', 'command', 'custom_prompt']),
  name: safeNameSchema,
  version: z.string(),
  description: z.string().optional(),
  runtime: z.string().optional(),
  files: z.array(safeFilePathSchema).optional(),
  config: ManifestConfigSchema,
  configFields: z.array(ConfigFieldSchema).optional(),
}).passthrough();
