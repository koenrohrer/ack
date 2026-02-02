import { z } from 'zod';

// ---------------------------------------------------------------------------
// Hook schemas
// ---------------------------------------------------------------------------

/**
 * A single hook entry -- a command, prompt, or agent that fires on an event.
 */
export const HookEntrySchema = z.object({
  type: z.enum(['command', 'prompt', 'agent']),
  command: z.string().optional(),
  prompt: z.string().optional(),
  timeout: z.number().optional(),
});

/**
 * A matcher + list of hooks for one pattern within a hook event.
 */
export const HookMatcherSchema = z.object({
  matcher: z.string().default(''),
  hooks: z.array(HookEntrySchema),
}).passthrough();

/**
 * Hook configuration -- maps event names to arrays of matchers.
 * Event names include "PreToolUse", "PostToolUse", "Notification", etc.
 */
export const HooksSchema = z.record(z.string(), z.array(HookMatcherSchema));

// ---------------------------------------------------------------------------
// Settings file schema (claude-code settings.json / .claude/settings.json)
// ---------------------------------------------------------------------------

/**
 * Claude Code settings file.
 *
 * Uses `.passthrough()` to preserve any unknown fields the user may have,
 * since Claude Code can add new settings at any time.
 */
export const SettingsFileSchema = z
  .object({
    hooks: HooksSchema.optional(),
    permissions: z
      .object({
        allow: z.array(z.string()).optional(),
        deny: z.array(z.string()).optional(),
        ask: z.array(z.string()).optional(),
      })
      .optional(),
    env: z.record(z.string(), z.string()).optional(),
    disabledMcpServers: z.array(z.string()).optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// MCP server schemas
// ---------------------------------------------------------------------------

/**
 * Single MCP server configuration.
 *
 * Uses `.passthrough()` to preserve vendor-specific extensions.
 */
export const McpServerSchema = z
  .object({
    command: z.string(),
    args: z.array(z.string()).optional().default([]),
    env: z.record(z.string(), z.string()).optional().default({}),
    type: z.enum(['stdio', 'http', 'sse']).optional(),
    transport: z.enum(['stdio', 'http', 'sse']).optional(),
    url: z.string().optional(),
    disabled: z.boolean().optional(),
  })
  .passthrough();

/**
 * MCP configuration file (.mcp.json / managed-mcp.json).
 *
 * Uses `.passthrough()` to preserve unknown top-level fields.
 */
export const McpFileSchema = z
  .object({
    mcpServers: z.record(z.string(), McpServerSchema).optional().default({}),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// ~/.claude.json schema
// ---------------------------------------------------------------------------

/**
 * The multi-purpose ~/.claude.json file.
 *
 * Only defines the mcpServers field we manage -- everything else (OAuth tokens,
 * preferences, project history) is preserved via `.passthrough()`.
 * We intentionally avoid defining other fields to prevent data loss.
 */
export const ClaudeJsonSchema = z
  .object({
    mcpServers: z.record(z.string(), McpServerSchema).optional().default({}),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Skill and command frontmatter schemas
// ---------------------------------------------------------------------------

/**
 * Frontmatter for SKILL.md files in the skills directory.
 *
 * Note: `allowed-tools` is a comma-separated string, NOT an array.
 * This matches Claude Code's actual format (Pitfall 5 from CONTEXT.md).
 */
export const SkillFrontmatterSchema = z.object({
  name: z.string().max(64),
  description: z.string().max(1024),
  'allowed-tools': z.string().optional(),
  model: z.string().optional(),
  'disable-model-invocation': z.boolean().optional(),
  'user-invocable': z.boolean().optional(),
});

/**
 * Frontmatter for command.md files in the commands directory.
 *
 * Commands may have no frontmatter at all, so the entire schema is optional.
 */
export const CommandFrontmatterSchema = z
  .object({
    description: z.string().optional(),
    'argument-hint': z.string().optional(),
    model: z.string().optional(),
    'allowed-tools': z.string().optional(),
  })
  .optional();

// ---------------------------------------------------------------------------
// Schema registry map
// ---------------------------------------------------------------------------

/**
 * Named schema registry for use with SchemaService.
 *
 * Maps human-readable schema names to their Zod types.
 * SchemaService registers these so validation callers reference schemas by name.
 */
export const claudeCodeSchemas: Record<string, z.ZodType> = {
  'settings-file': SettingsFileSchema,
  'mcp-file': McpFileSchema,
  'claude-json': ClaudeJsonSchema,
  'mcp-server': McpServerSchema,
  'skill-frontmatter': SkillFrontmatterSchema,
  'command-frontmatter': CommandFrontmatterSchema,
  'hook-entry': HookEntrySchema,
  'hook-matcher': HookMatcherSchema,
  hooks: HooksSchema,
};
