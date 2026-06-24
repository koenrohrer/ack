import { z } from 'zod';

// ---------------------------------------------------------------------------
// MCP server schema
// ---------------------------------------------------------------------------

/**
 * A single MCP server entry in Hermes config.yaml.
 *
 * Supports both stdio servers (command + args) and HTTP servers (url).
 * Like Codex, Hermes uses `enabled` (not `disabled` like Claude Code) for
 * server activation state -- but `enabled` may be a YAML bool or a string
 * ('true'|'1'|'yes' truthy) per hermes_cli/mcp_config.py.
 *
 * Uses `.passthrough()` to preserve unknown fields the user may have.
 */
export const HermesMcpServerSchema = z
  .object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    auth: z.string().optional(),
    oauth: z.record(z.string(), z.unknown()).optional(),
    enabled: z.union([z.boolean(), z.string()]).optional(),
    transport: z.string().optional(),
    tools: z
      .object({
        include: z.array(z.string()).optional(),
        exclude: z.array(z.string()).optional(),
        prompts: z.union([z.boolean(), z.string()]).optional(),
        resources: z.union([z.boolean(), z.string()]).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Config file schema (config.yaml)
// ---------------------------------------------------------------------------

/**
 * Hermes configuration file (config.yaml).
 *
 * `.passthrough()` preserves model/providers/skills/quick_commands/hooks and
 * other keys ACK does not manage, preventing data loss on write-back.
 */
export const HermesConfigSchema = z
  .object({
    mcp_servers: z.record(z.string(), HermesMcpServerSchema).optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Schema registry map
// ---------------------------------------------------------------------------

/**
 * Named schema registry for use with SchemaService.
 *
 * Maps human-readable schema names to their Zod types.
 * SchemaService registers these so validation callers reference schemas by name.
 */
export const hermesSchemas: Record<string, z.ZodType> = {
  'hermes-config': HermesConfigSchema,
  'hermes-mcp-server': HermesMcpServerSchema,
};
