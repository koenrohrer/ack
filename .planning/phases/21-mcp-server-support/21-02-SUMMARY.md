---
phase: 21-mcp-server-support
plan: "02"
subsystem: adapters
tags: [copilot, mcp, json-schema, zod, file-watcher, adapter-pattern]

# Dependency graph
requires:
  - phase: 21-01
    provides: parseCopilotMcpFile, addCopilotMcpServer, removeCopilotMcpServer, copilotSchemas — the parser/writer/schema files wired in this plan

provides:
  - CopilotAdapter with real readTools (routes by type and scope via parseCopilotMcpFile)
  - CopilotAdapter removeTool delegating to removeCopilotMcpServer
  - CopilotAdapter installMcpServer delegating to addCopilotMcpServer
  - CopilotAdapter getWatchPaths returning .vscode/mcp.json and userMcpJson paths
  - copilotSchemas registered in extension.ts startup so ConfigService can validate Copilot MCP files
  - getJsonPath correctly routes Copilot MCP tools to ['servers', name] instead of ['mcpServers', name]

affects: [22-copilot-prompt-support, 23-copilot-skill-support, file-watcher, tool-tree, marketplace]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - ensureWriteServices() private guard pattern — assert write services initialized before mutations
    - Adapter delegation pattern — adapter methods call typed parser/writer functions, no logic duplication
    - File path heuristic for JSON key routing — source.filePath used to discriminate Copilot vs Claude Code MCP key names

key-files:
  created: []
  modified:
    - src/adapters/copilot/copilot.adapter.ts
    - src/extension.ts
    - src/views/tool-tree/tool-tree.command-utils.ts
    - src/test/unit/tool-tree.commands.test.ts

key-decisions:
  - "getJsonPath uses source.filePath heuristic to detect Copilot: endsWith('mcp.json') + (.vscode OR Code/User OR Code\\User)"
  - "getJsonPath Pick extended to include 'source' — callers pass full NormalizedTool so no call sites needed updating"
  - "writeTool Phase 21+ stub deliberately preserved — it is not in scope for this plan"

patterns-established:
  - "ensureWriteServices() guard: throw descriptive error when configService/backupService not injected, called before any write operation"
  - "File path heuristic for Copilot detection in getJsonPath: check filePath suffix and directory name rather than adding adapter metadata"

requirements-completed: [MCP-01, MCP-02, MCP-03, MCP-04, MCP-05]

# Metrics
duration: 3min
completed: 2026-02-21
---

# Phase 21 Plan 02: MCP Server Support Wire-up Summary

**CopilotAdapter MCP read/write/remove/watch fully wired through parseCopilotMcpFile, addCopilotMcpServer, removeCopilotMcpServer, copilotSchemas registered at startup, and getJsonPath fixed to return ['servers', name] for Copilot MCP tools**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-02-21T23:17:25Z
- **Completed:** 2026-02-21T23:20:09Z
- **Tasks:** 2 completed
- **Files modified:** 4

## Accomplishments

- Replaced all Phase 20 stubs in CopilotAdapter: readTools, removeTool, installMcpServer, getWatchPaths now have real implementations routing through parser/writer functions from Phase 21-01
- Registered copilotSchemas in extension.ts alongside claudeCodeSchemas and codexSchemas so ConfigService.writeConfigFile() can validate Copilot MCP files
- Fixed getJsonPath routing bug: Copilot tools now return ['servers', name] (matching mcp.json's actual key) instead of ['mcpServers', name]
- Added 5 new test cases for getJsonPath Copilot detection (project-scope, user-scope macOS, user-scope Windows, Claude Code .mcp.json, existing tests preserved)

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement CopilotAdapter MCP methods** - `c6fe919` (feat)
2. **Task 2: Register copilotSchemas in extension.ts + fix getJsonPath for Copilot MCP** - `8026878` (feat)

**Plan metadata:** TBD (docs: complete plan)

## Files Created/Modified

- `src/adapters/copilot/copilot.adapter.ts` - Replaced Phase 20 stubs with real implementations; added ensureWriteServices() private guard; added parseCopilotMcpFile/addCopilotMcpServer/removeCopilotMcpServer imports; updated JSDoc
- `src/extension.ts` - Added copilotSchemas import and schemas.registerSchemas(copilotSchemas) after codexSchemas registration
- `src/views/tool-tree/tool-tree.command-utils.ts` - Extended getJsonPath Pick to include 'source'; added isCopilot file path heuristic returning 'servers' key for Copilot tools
- `src/test/unit/tool-tree.commands.test.ts` - Added source field to makeTool helper; added 5 Copilot-specific test cases

## Decisions Made

- getJsonPath source.filePath heuristic checks `endsWith('mcp.json') && (includes('.vscode') || includes('Code/User') || includes('Code\\User'))` — simpler than adding adapter-specific metadata to NormalizedTool
- getJsonPath Pick type extended to include 'source' — the caller in tool-tree.commands.ts passes a full NormalizedTool so no call site updates were required
- writeTool "Phase 21+" stub left in place — writeTool was not in scope for this plan and the comment is still accurate

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All MCP-01 through MCP-05 requirements are now fully observable to users with GitHub Copilot installed
- getWatchPaths returns non-empty arrays, so FileWatcherManager will now watch .vscode/mcp.json on project open
- Phase 22 (CustomPrompt/Skill parsing) can build on the same adapter pattern established here

---
*Phase: 21-mcp-server-support*
*Completed: 2026-02-21*
