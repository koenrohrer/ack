---
phase: 21-mcp-server-support
plan: "01"
subsystem: adapters
tags: [copilot, mcp, zod, schema, parser, writer]

# Dependency graph
requires:
  - phase: 20-copilot-adapter-scaffold
    provides: CopilotAdapter scaffold with getMcpFilePath and getMcpSchemaKey stubs
provides:
  - CopilotMcpFileSchema (servers key, inputs array, passthrough) in src/adapters/copilot/schemas.ts
  - copilotSchemas registry map (copilot-mcp, copilot-mcp-server)
  - parseCopilotMcpFile() — reads servers key from mcp.json, always Enabled
  - addCopilotMcpServer() / removeCopilotMcpServer() — write via ConfigService pipeline
affects: [21-02, 21-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Copilot MCP uses servers key (not mcpServers) — must be maintained across all copilot files"
    - "Mutators spread current first to preserve inputs array on write-back"
    - "No disabled state for Copilot MCP servers — all entries always ToolStatus.Enabled"

key-files:
  created:
    - src/adapters/copilot/schemas.ts
    - src/adapters/copilot/parsers/mcp.parser.ts
    - src/adapters/copilot/writers/mcp.writer.ts

key-decisions:
  - "parseCopilotMcpFile uses data.servers (not data.mcpServers) per Copilot's actual mcp.json format"
  - "inputs array modeled explicitly in CopilotMcpFileSchema to survive read-mutate-validate-write cycles"
  - "No toggleCopilotMcpServer function — Copilot has no server-level disable mechanism"
  - "transport mapped from config.type (Copilot's field name) not config.transport"
  - "Both mutators return { ...current, servers } — never { servers } alone — to preserve inputs"

patterns-established:
  - "parsers/mcp.parser.ts pattern: read → null-check → validate → extract — mirrors claude-code exactly"
  - "writers/mcp.writer.ts pattern: spread current first in mutator — ensures non-servers fields survive"
  - "Schema passthrough at every level: server, input, and file schemas all use .passthrough()"

requirements-completed: [MCP-01, MCP-02, MCP-03, MCP-04]

# Metrics
duration: 6min
completed: 2026-02-21
---

# Phase 21 Plan 01: Copilot MCP Schemas, Parser, and Writer Summary

**Zod schemas, file parser, and ConfigService-backed writer for Copilot mcp.json using `servers` key (not `mcpServers`), with explicit `inputs` array preservation on write-back**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-02-21T14:13:13Z
- **Completed:** 2026-02-21T14:19:00Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Created `CopilotMcpFileSchema` with `servers` key and `inputs` array modeled explicitly so both survive round-trips
- Created `parseCopilotMcpFile()` mirroring claude-code pattern: file-absent returns [], schema error returns single Error tool, all entries always `ToolStatus.Enabled`
- Created `addCopilotMcpServer()` and `removeCopilotMcpServer()` with `{ ...current, servers }` spread to prevent inputs loss

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Copilot MCP schemas** - `73a8810` (feat)
2. **Task 2: Create Copilot MCP parser** - `216e1fa` (feat)
3. **Task 3: Create Copilot MCP writer** - `83d0230` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `src/adapters/copilot/schemas.ts` - CopilotMcpFileSchema, CopilotMcpServerSchema, CopilotMcpInputSchema, copilotSchemas registry
- `src/adapters/copilot/parsers/mcp.parser.ts` - parseCopilotMcpFile() reading servers key, always-Enabled entries
- `src/adapters/copilot/writers/mcp.writer.ts` - addCopilotMcpServer() and removeCopilotMcpServer() with inputs-preserving mutators

## Decisions Made

- `inputs` array is modeled explicitly in the Zod schema (not left to passthrough) because Copilot's secret-injection system depends on it surviving write-back cycles
- `transport` metadata field is populated from `config.type` (Copilot's field name) rather than `config.transport` (Claude Code's field name)
- Both writer mutators return `{ ...current, servers }` — spreading current first — to ensure `inputs` and any other top-level fields are never lost

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02 can now wire `parseCopilotMcpFile` into `CopilotAdapter.getMcpTools()` replacing the `Promise.resolve([])` scaffold
- Plan 02 can wire `addCopilotMcpServer` / `removeCopilotMcpServer` into adapter write methods
- Plan 03 (TDD) can write integration tests against these three files independently
- `copilotSchemas` registry map is ready to be registered in SchemaService (Phase 21 Plan 02 task)

---
*Phase: 21-mcp-server-support*
*Completed: 2026-02-21*
