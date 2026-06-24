import { z } from 'zod';

// ---------------------------------------------------------------------------
// MCP server schema
// ---------------------------------------------------------------------------

/**
 * A single MCP server entry in Pi's `mcp.json` (pi-mcp-extension format).
 *
 * Supports both stdio servers (command + args) and HTTP servers (url).
 *
 * `transport` and `lifecycle` are kept as loose strings (not enums) for
 * forward-compat: Pi MCP is extension-provided and the on-disk format is not
 * yet a stable contract, so we avoid rejecting values we don't recognize.
 *
 * Uses `.passthrough()` to preserve unknown fields the user may have.
 */
export const PiMcpServerSchema = z
  .object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    url: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    transport: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    lifecycle: z.string().optional(),
    tools: z.array(z.string()).optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// MCP config file schema (mcp.json)
// ---------------------------------------------------------------------------

/**
 * Pi MCP configuration file (mcp.json).
 *
 * Servers live under the top-level `mcpServers` key. `settings` is preserved
 * if present. Uses `.passthrough()` to keep any other unknown top-level fields
 * so ACK does not drop data when writing back.
 */
export const PiMcpFileSchema = z
  .object({
    mcpServers: z.record(z.string(), PiMcpServerSchema).optional().default({}),
    settings: z.record(z.string(), z.unknown()).optional(),
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
export const piSchemas: Record<string, z.ZodType> = {
  'pi-mcp-file': PiMcpFileSchema,
  'pi-mcp-server': PiMcpServerSchema,
};
