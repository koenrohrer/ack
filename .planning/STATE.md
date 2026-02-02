# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-01)

**Core value:** Developers can discover, install, configure, and switch between sets of agent tools without leaving VS Code
**Current focus:** Phase 5 complete -- One-Click Install. All 3 plans done, 6 bugfixes, checkpoint approved. Phase 6 (Profile System) is next.

## Current Position

Phase: 5 of 8 (One-Click Install) -- COMPLETE
Plan: 3 of 3 in current phase -- COMPLETE
Status: Phase complete, ready for Phase 6
Last activity: 2026-02-02 -- Checkpoint approved, 05-03-SUMMARY created, Phase 5 verified

Progress: [██████░░░░] ~62%

## Performance Metrics

**Velocity:**
- Total plans completed: 16
- Average duration: 4m
- Total execution time: 81m

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 4/4 | 14m | 4m |
| 02 | 3/3 | 12m | 4m |
| 03 | 3/3 | 12m | 4m |
| 04 | 3/3 | 18m | 6m |
| 05 | 3/3 | 25m | 8m |

**Recent Trend:**
- Last 5 plans: 04-03 (8m), 05-01 (5m), 05-02 (5m), 05-03 (15m with checkpoint)
- Trend: checkpoint plans take longer due to manual testing + bugfix cycles

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: 8 phases derived from 27 requirements at comprehensive depth
- [Roadmap]: Phase 4 (Marketplace) depends on Phase 1 only, not Phase 3, enabling parallel work if needed
- [01-01]: Used ESLint 9 flat config (eslint.config.mjs) instead of legacy .eslintrc.json
- [01-01]: @types/write-file-atomic pinned to ^4.0.3 (latest available)
- [01-02]: Zod schemas use .passthrough() on all top-level objects to preserve unknown fields
- [01-02]: SchemaService uses string-based registry (decouples validation from platform-specific schemas)
- [01-02]: BackupService uses numbered suffix pattern (.bak.1-.bak.5) with shift-rotate
- [01-03]: ClaudeCodePaths uses getters for static paths, methods for workspace-relative paths
- [01-03]: Parsers accept FileIOService/SchemaService as params (DI over singletons)
- [01-03]: MCP disabled state resolved from both disabledMcpServers array and per-server disabled field
- [01-03]: readDisabledMcpServers exported separately; adapter orchestrates two-step MCP read
- [01-04]: Canonical key uses type:name for most tools, hooks use hook:event:matcher
- [01-04]: APPLICABLE_SCOPES as static map (tool type -> scope mapping is platform invariant)
- [01-04]: getServices() module-level export for cross-module service access
- [01-04]: Test command registered in contributes.commands for manual verification
- [02-01]: APPLICABLE_SCOPES/SCOPE_PRECEDENCE duplicated in model (private in ConfigService)
- [02-01]: Scope shown via composite SVG icon shape only, not text in description field
- [02-01]: Description field reserved for error messages and (active) indicator only
- [02-01]: MCP sub-tools show config details, not runtime MCP protocol tool lists
- [02-02]: Pure functions extracted to command-utils module to avoid VS Code import in unit tests
- [02-02]: Re-exported from commands module so consumers have a single import source
- [02-03]: Pure logic extracted to file-watcher.utils.ts for testability (matching command-utils pattern)
- [02-03]: Notification setting check lives in extension.ts callback, not in FileWatcherManager
- [02-03]: Skills/commands dirs watched recursively; config file dirs non-recursively
- [03-01]: IPlatformAdapter.removeTool accepts NormalizedTool instead of (toolId, type, scope)
- [03-01]: ConfigService and BackupService are optional constructor params on ClaudeCodeAdapter
- [03-01]: HookMatcherSchema gets .passthrough() to preserve custom disabled field
- [03-02]: ToolManagerService uses dynamic imports for writer modules to keep coupling loose
- [03-02]: getMcpFileInfo derives schema key from tool.source.filePath (endsWith .claude.json check)
- [04-01]: RegistryConfigReader interface injected via constructor for testability (DI over require)
- [04-01]: ETags not restored from globalState without cached index data (304 needs body)
- [04-02]: Separate tsconfig.webview.json for browser-target React JSX (incompatible with Node16 module resolution)
- [04-02]: eslint routes webview ts/tsx to webview tsconfig; .d.ts excluded from lint
- [04-02]: Main tsconfig.json excludes webview directory to prevent cross-contamination
- [04-03]: Markdown rendered client-side in webview with marked + DOMPurify (avoids jsdom in extension host)
- [04-03]: All filtering/sorting/pagination done client-side in useMarketplace hook (cached full list, no round-trips)
- [04-03]: Added forceRefresh parameter to RegistryService.fetchAllIndexes for user-initiated refresh
- [05-01]: Env merge order: manifest defaults < existing values < user-provided values
- [05-01]: Single-file commands write to commands dir; multi-file commands get subdirectory
- [05-01]: Runtime check is warn-but-allow (caller decides whether to proceed)
- [05-02]: Ref-based native event binding for vscode-textfield web components in ConfigForm
- [05-02]: InstalledToolInfo replaces string[] for scope-aware installed tool tracking
- [05-02]: ConfigForm cancel re-triggers install flow (scope picker reappears)
- [05-03]: normalizeToolName() for registry display name vs config name matching
- [05-03]: Stash-based hook toggle (_disabledHooks) replaces non-functional disabled:true field
- [05-03]: Parser reads _disabledHooks entries with ToolStatus.Disabled and metadata.stashed=true
- [05-03]: removeHook accepts stashed param for deleting disabled hooks

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-02-02
Stopped at: Phase 5 complete. All plans executed, checkpoint approved, summary created, verifier running. Ready for Phase 6 (Profile System).
Resume file: None (phase complete, .continue-here cleaned up)
