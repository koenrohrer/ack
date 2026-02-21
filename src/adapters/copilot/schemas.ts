import { z } from 'zod';

// ---------------------------------------------------------------------------
// MCP server schema
// ---------------------------------------------------------------------------

/**
 * Single Copilot MCP server configuration.
 *
 * Note: Copilot servers have no `disabled` field — there is no server-level
 * disable mechanism in VS Code Copilot. All entries are always enabled.
 *
 * Uses `.passthrough()` to preserve vendor-specific extensions on round-trips.
 */
export const CopilotMcpServerSchema = z
  .object({
    type: z.enum(['stdio', 'http', 'sse']).optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    envFile: z.string().optional(),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// MCP input schema
// ---------------------------------------------------------------------------

/**
 * A single input variable declaration in Copilot's mcp.json.
 *
 * The `inputs` array lives at the top level of mcp.json alongside `servers`.
 * It must be explicitly modeled so it survives read-mutate-validate-write
 * cycles without being stripped or corrupted by the Zod validator.
 *
 * Uses `.passthrough()` to preserve any unknown fields.
 */
export const CopilotMcpInputSchema = z
  .object({
    type: z.string(),
    id: z.string(),
    description: z.string().optional(),
    password: z.boolean().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// MCP file schema
// ---------------------------------------------------------------------------

/**
 * Copilot MCP configuration file (mcp.json).
 *
 * Uses `servers` (NOT `mcpServers`) — this is Copilot's own key name and must
 * NOT be confused with Claude Code's `mcpServers` key.
 *
 * The `inputs` array is explicitly modeled (not left to passthrough) because:
 * - Copilot's secret-injection system depends on it
 * - Losing it during a write-back would break server auth workflows
 * - read-mutate-validate-write cycle must preserve it exactly
 *
 * Uses `.passthrough()` at the top level to preserve any additional fields.
 */
export const CopilotMcpFileSchema = z
  .object({
    servers: z.record(z.string(), CopilotMcpServerSchema).optional().default({}),
    inputs: z.array(CopilotMcpInputSchema).optional().default([]),
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
export const copilotSchemas: Record<string, z.ZodType> = {
  'copilot-mcp': CopilotMcpFileSchema,
  'copilot-mcp-server': CopilotMcpServerSchema,
};
