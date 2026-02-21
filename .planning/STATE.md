# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-18)

**Core value:** Developers can discover, install, configure, and switch between sets of agent tools without leaving VS Code or touching config files manually.
**Current focus:** v1.2 Copilot Support — Phase 21 (Copilot MCP Read)

## Current Position

Phase: 21 of 25
Plan: 4 of 4 in current phase
Status: Phase 21 Plan 04 complete — all five MCP requirements (MCP-01 through MCP-05) human-verified in Extension Development Host; copilot-chat detection fix applied
Last activity: 2026-02-21 — Phase 21 Plan 04 executed (human verification checkpoint — all MCP requirements approved)

Progress: v1.1 complete (53/53 plans). v1.2: Phase 20 complete (2/2 plans). Phase 21: 4 plans complete (phase complete).

## Milestone History

- v1.0 MVP -- Shipped 2026-02-03 (11 phases, 33 plans)
- v1.1 Codex Support -- Shipped 2026-02-18 (9 phases, 22 plans)

## Accumulated Context

### Decisions

All decisions logged in PROJECT.md Key Decisions table.

Recent decisions affecting v1.2:
- CopilotAdapter fits IPlatformAdapter exactly — no interface changes needed
- Detection via `vscode.extensions.getExtension('GitHub.copilot')` (not filesystem)
- MCP schema uses `servers` key (not `mcpServers`) — must be defined independently
- `inputs` array must be preserved on write (modeled explicitly in Zod schema)
- Phase 20 must land before any other v1.2 phase — ESLint boundary and marketplace conditional fix are prerequisites

Phase 20 execution decisions (2026-02-21):
- vsCodeUserDir derived at construction time via path.dirname(path.dirname(context.globalStorageUri.fsPath))
- getMcpFilePath fully implemented using CopilotPaths so Phase 21 reads immediately
- getMcpSchemaKey returns 'copilot-mcp' — schema registration deferred to Phase 21
- Scaffold read methods return Promise.resolve([]) without routing
- Scaffold write methods throw Error with Phase 21+ reference
- adapter.id === 'copilot' id-check used directly in QuickPick loop (convention-based, no interface change)
- CONFIG_DIR_LABELS Record<string, string> lookup map replaces two-way ternary in marketplace promptForScope
- copilot boundary guard ignores src/adapters/copilot/** (same pattern as claude-code and codex)

Phase 21 Plan 01 execution decisions (2026-02-21):
- inputs array modeled explicitly in CopilotMcpFileSchema (not via passthrough) to survive read-mutate-validate-write cycles
- transport metadata mapped from config.type (Copilot's field name), not config.transport (Claude Code's name)
- Both writer mutators return { ...current, servers } — spread current first — to preserve inputs on write-back
- No toggleCopilotMcpServer — Copilot has no server-level disable mechanism

Phase 21 Plan 02 execution decisions (2026-02-21):
- getJsonPath uses source.filePath heuristic to detect Copilot: endsWith('mcp.json') + (.vscode OR Code/User OR Code\\User)
- getJsonPath Pick extended to include 'source' — callers pass full NormalizedTool so no call site updates required
- copilotSchemas registered at startup in extension.ts alongside claudeCodeSchemas and codexSchemas
- writeTool Phase 21+ stub left in place — writeTool is not in scope for Phase 21

Phase 21 Plan 03 execution decisions (2026-02-21):
- Tests use real services (FileIOService, SchemaService, ConfigService, BackupService) on tmpdir — consistent with parsers.test.ts and writers.test.ts patterns
- copilotSchemas (not claudeCodeSchemas) registered in test SchemaService — schema-specific isolation
- Tests went GREEN immediately (Plan 01 implementations were correct); no RED phase iteration needed

Phase 21 Plan 04 execution decisions (2026-02-21):
- detect() checks GitHub.copilot OR GitHub.copilot-chat — users may have only the chat extension installed; checking both ensures Copilot appears for all valid installs

### Roadmap Evolution

v1.0 roadmap archived to `.planning/milestones/v1.0-ROADMAP.md`
v1.0 requirements archived to `.planning/milestones/v1.0-REQUIREMENTS.md`
v1.1 roadmap archived to `.planning/milestones/v1.1-ROADMAP.md`
v1.1 requirements archived to `.planning/milestones/v1.1-REQUIREMENTS.md`

### Pending Todos

0 pending todos.

### Blockers/Concerns

Known tech debt from v1.1 (addressed in Phase 20 — now resolved):
- [RESOLVED] Marketplace `configDir` two-way conditional — replaced with CONFIG_DIR_LABELS lookup map
- [RESOLVED] ESLint boundary guard did not cover `**/adapters/copilot/*` — guard now covers all three adapters

Known gaps to validate during implementation:
- Phase 21: Verify `FileWatcherManager` handles non-existent `.vscode/` at extension activate
- Phase 21: Confirm Windows CI handles `APPDATA` fallback in `getVSCodeUserDir()`
- Phase 22/23: Confirm `extractFrontmatter()` handles files with no `---` delimiters
- Phase 24/25: Non-default VS Code profiles use UUID-based paths not derivable from current API — support default profile only, emit warning for non-default

## Session Continuity

Last session: 2026-02-21
Stopped at: Completed 21-mcp-server-support/21-04-PLAN.md (Phase 21 fully verified and complete)
Resume file: None
