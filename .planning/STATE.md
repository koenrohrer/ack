# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-18)

**Core value:** Developers can discover, install, configure, and switch between sets of agent tools without leaving VS Code or touching config files manually.
**Current focus:** v1.2 Copilot Support — Phase 21 (Copilot MCP Read)

## Current Position

Phase: 21 of 25
Plan: 0 of ? in current phase
Status: Phase 20 complete — ready for Phase 21
Last activity: 2026-02-21 — Phase 20 Plan 02 executed (ESLint guard, QuickPick hide, marketplace configDir fix)

Progress: v1.1 complete (53/53 plans). v1.2: Phase 20 complete (2/2 plans).

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
Stopped at: Completed 20-copilot-adapter-scaffold/20-02-PLAN.md
Resume file: None
