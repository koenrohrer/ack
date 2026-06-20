import { z } from 'zod';

// ---------------------------------------------------------------------------
// MCP server schema
// ---------------------------------------------------------------------------

/**
 * A single MCP server entry in Codex config.toml.
 *
 * Supports both stdio servers (command + args) and HTTP servers (url).
 * Note: Codex uses `enabled` (not `disabled` like Claude Code) for server
 * activation state.
 *
 * Uses `.passthrough()` to preserve unknown fields the user may have.
 */
export const CodexMcpServerSchema = z
  .object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    url: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean().optional(),
    enabled_tools: z.array(z.string()).optional(),
    disabled_tools: z.array(z.string()).optional(),
    startup_timeout_sec: z.number().optional(),
    tool_timeout_sec: z.number().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Config file schema (config.toml)
// ---------------------------------------------------------------------------

/**
 * Codex configuration file (config.toml).
 *
 * Uses `.passthrough()` to preserve unknown fields (auth, history, otel,
 * ghost_snapshot, etc.) that ACK does not manage. This prevents data loss
 * when ACK writes back to the config file.
 */
export const CodexConfigSchema = z
  .object({
    model: z.string().optional(),
    model_provider: z.string().optional(),
    approval_policy: z
      .enum(['suggest', 'auto-edit', 'full-auto'])
      .optional(),
    sandbox_mode: z
      .enum(['read-only', 'workspace-write', 'danger-full-access'])
      .optional(),
    mcp_servers: z.record(z.string(), CodexMcpServerSchema).optional(),
    profile: z.string().optional(),
    profiles: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Skill frontmatter schema
// ---------------------------------------------------------------------------

/**
 * Frontmatter for SKILL.md files in the Codex skills directory.
 *
 * Note: Codex skills use YAML frontmatter (not TOML) despite the config
 * being TOML. This matches Claude Code's skill format convention.
 */
export const CodexSkillFrontmatterSchema = z.object({
  name: z.string().max(100),
  description: z.string().max(500),
});

// ---------------------------------------------------------------------------
// Schema registry map
// ---------------------------------------------------------------------------

/**
 * Named schema registry for use with SchemaService.
 *
 * Maps human-readable schema names to their Zod types.
 * SchemaService registers these so validation callers reference schemas by name.
 */
export const codexSchemas: Record<string, z.ZodType> = {
  'codex-config': CodexConfigSchema,
  'codex-mcp-server': CodexMcpServerSchema,
  'codex-skill-frontmatter': CodexSkillFrontmatterSchema,
};
