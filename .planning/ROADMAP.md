# Roadmap: Agent Config Keeper

## Overview

This roadmap delivers a VS Code extension that lets developers discover, install, configure, and switch between sets of Claude Code agent tools from a unified sidebar and marketplace. The phases progress from config file I/O (the foundation everything depends on) through the sidebar environment view, tool management actions, the GitHub-backed marketplace, one-click installation, profile switching, the rich configuration panel, and finally profile portability. Each phase delivers an incrementally usable capability that builds on the previous.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Extension Scaffold & Config I/O** - Project setup, config file reading/writing, and the Claude Code adapter
- [ ] **Phase 2: Sidebar Environment View** - Tree view showing installed tools grouped by type with status and scope
- [ ] **Phase 3: Tool Management** - Enable/disable, delete, and scope controls for individual tools
- [ ] **Phase 4: Marketplace Registry & Discovery** - GitHub registry integration, searchable marketplace webview with filtering
- [ ] **Phase 5: One-Click Install** - Install tools from the marketplace into the local environment
- [ ] **Phase 6: Profile System** - Named profiles for switching between tool sets
- [ ] **Phase 7: Configuration Panel** - Rich webview panel for managing extension settings and per-tool configuration
- [ ] **Phase 8: Profile Portability & Polish** - Import/export profiles and workspace-profile association

## Phase Details

### Phase 1: Extension Scaffold & Config I/O
**Goal**: The extension can read, validate, and safely write all Claude Code config file types across global and project scopes
**Depends on**: Nothing (first phase)
**Requirements**: CORE-01, CORE-02, CORE-03, CORE-04, CORE-05
**Success Criteria** (what must be TRUE):
  1. Extension activates in VS Code without errors and registers its contribution points
  2. Extension reads and correctly parses skills (`SKILL.md` in `~/.claude/skills/<skill>/` and `.claude/skills/<skill>/`), slash commands in `.claude/commands/`, hooks in settings files (`~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, managed settings), and MCP servers in `~/.claude.json`, `.mcp.json`, and managed-mcp.json
  3. Extension writes config files using atomic write (write-to-temp-then-rename) with backup-before-write, and validates against schemas before writing
  4. A ClaudeCodeAdapter class maps all Claude Code-specific formats to normalized internal types, and no other module references Claude Code file paths directly
  5. Extension correctly distinguishes and reads from user, project, local, and managed config scopes (settings, MCP, skills/commands as applicable)
**Plans**: TBD

Plans:
- [ ] 01-01: VS Code extension scaffold, build tooling, and project structure
- [ ] 01-02: FileIOService with atomic writes, backups, and schema validation
- [ ] 01-03: ClaudeCodeAdapter and ConfigService for reading/normalizing all tool types
- [ ] 01-04: Dual-scope config resolution (global + project)

### Phase 2: Sidebar Environment View
**Goal**: Users can see their full Claude Code tool inventory in a sidebar tree, grouped by type, with file preview and status indicators
**Depends on**: Phase 1
**Requirements**: SIDE-01, SIDE-02, SIDE-03, SIDE-04, SIDE-05, SIDE-06
**Success Criteria** (what must be TRUE):
  1. User sees a sidebar tree view with top-level groups for Skills, MCP Servers, Hooks, and Commands, each expandable to show individual tools and their file/directory structure
  2. User can click any .md file in the tree to open a read-only preview of its contents in an editor tab
  3. Sidebar header displays the current profile name, or "Current Environment" when no profile is active
  4. Each tool in the tree shows a status indicator (enabled, disabled, or error) and a scope badge (global or project)
  5. Tree auto-refreshes when config files change externally (e.g., edited in terminal or by Claude Code)
**Plans**: TBD

Plans:
- [ ] 02-01: TreeDataProvider with grouped tool inventory and expand/collapse
- [ ] 02-02: File preview, status indicators, scope badges, and header display
- [ ] 02-03: FileSystemWatcher integration for live config change detection

### Phase 3: Tool Management
**Goal**: Users can enable, disable, delete, and change the scope of individual tools from the sidebar
**Depends on**: Phase 2
**Requirements**: TOOL-01, TOOL-02, TOOL-03, TOOL-04
**Success Criteria** (what must be TRUE):
  1. User can toggle a tool between enabled and disabled states via a context menu or inline action, and the underlying config file is updated immediately
  2. User can delete/uninstall a tool, which removes its files and config entries, with a confirmation prompt
  3. User can change a tool's scope between global and project-level, and the tool's config entries move to the appropriate location
  4. Sidebar tree reflects all management actions immediately without manual refresh
**Plans**: TBD

Plans:
- [ ] 03-01: ToolManager service with enable/disable/delete operations
- [ ] 03-02: Scope management (global to project and vice versa)
- [ ] 03-03: Sidebar context menus, inline actions, and install shortcut (TOOL-02 marketplace link)

### Phase 4: Marketplace Registry & Discovery
**Goal**: Users can browse, search, and filter available tools in a marketplace panel backed by a GitHub registry
**Depends on**: Phase 1
**Requirements**: MRKT-01, MRKT-02, MRKT-04, MRKT-05
**Success Criteria** (what must be TRUE):
  1. User can open a Marketplace panel that displays available tools fetched from a GitHub-based community registry
  2. User can search tools by name or keyword, and results update as they type
  3. User can filter marketplace listings by tool type (skills, MCP servers, hooks, commands) using tabs or a dropdown
  4. User can click a tool listing to view its full description, README content, and metadata before deciding to install
  5. Marketplace data is cached locally with ETag-based revalidation, so browsing does not exhaust GitHub API rate limits
**Plans**: TBD

Plans:
- [ ] 04-01: GitHub registry structure, index format, and RegistryService with caching
- [ ] 04-02: Marketplace webview scaffold (React, typed message protocol, CSP, state persistence)
- [ ] 04-03: Search, type filtering, and tool detail view

### Phase 5: One-Click Install
**Goal**: Users can install any tool from the marketplace into their environment with a single click
**Depends on**: Phase 3, Phase 4
**Requirements**: MRKT-03
**Success Criteria** (what must be TRUE):
  1. User can click "Install" on a marketplace listing and the tool is downloaded, placed in the correct location, and registered in the appropriate config file without manual steps
  2. If a tool requires configuration (e.g., MCP server API keys), the user is prompted for required values during install
  3. User sees progress feedback during install and a clear success or error message on completion
  4. After install, the tool appears immediately in the sidebar tree as enabled
**Plans**: TBD

Plans:
- [ ] 05-01: Install orchestrator for all four tool types (skills, MCP, hooks, commands)
- [ ] 05-02: Configuration prompts, progress feedback, and error handling
- [ ] 05-03: Post-install verification and sidebar refresh

### Phase 6: Profile System
**Goal**: Users can create named profiles (preset tool collections) and switch between them to manage their agent context
**Depends on**: Phase 3
**Requirements**: PROF-01, PROF-02
**Success Criteria** (what must be TRUE):
  1. User can create a new named profile by selecting which currently-installed tools should be included
  2. User can edit an existing profile to add or remove tools, and rename or delete profiles
  3. User can switch to a different profile from the sidebar header or the command palette, and the switch enables/disables the correct tools within seconds
  4. Sidebar header updates to show the active profile name after switching
**Plans**: TBD

Plans:
- [ ] 06-01: Profile data model and ProfileService (CRUD, storage in globalState)
- [ ] 06-02: Profile switching logic (diff-based batch enable/disable)
- [ ] 06-03: Sidebar profile selector and command palette integration

### Phase 7: Configuration Panel
**Goal**: Users can manage all extension settings, profiles, and per-tool configuration in a rich webview panel
**Depends on**: Phase 6
**Requirements**: CONF-01, CONF-02, CONF-03
**Success Criteria** (what must be TRUE):
  1. User can open a "Configure Agent" webview panel from the sidebar or command palette
  2. User can manage profiles (create, edit, delete, switch) entirely within the configuration panel without using context menus
  3. User can edit per-tool settings (e.g., MCP server environment variables, hook trigger conditions) within the configuration panel, and changes are written to the correct config files
  4. Configuration panel preserves its state when the tab is hidden and restored (no blank panel on tab switch)
**Plans**: TBD

Plans:
- [ ] 07-01: Configure Agent webview scaffold (React, state persistence, typed messages)
- [ ] 07-02: Profile management UI within the panel
- [ ] 07-03: Per-tool settings editor with config file write-back

### Phase 8: Profile Portability & Polish
**Goal**: Users can share profiles across machines and projects, and profiles auto-activate per workspace
**Depends on**: Phase 6
**Requirements**: PROF-03, PROF-04
**Success Criteria** (what must be TRUE):
  1. User can export a profile to a JSON file that can be shared or checked into version control
  2. User can import a profile from a JSON file, and any referenced tools not yet installed are flagged clearly
  3. User can associate a profile with a workspace so it auto-activates when that project is opened in VS Code
  4. When opening a workspace with an associated profile, the correct tools are enabled/disabled automatically without user intervention
**Plans**: TBD

Plans:
- [ ] 08-01: Profile export/import (JSON format, missing tool detection)
- [ ] 08-02: Workspace-profile association and auto-activation on workspace open

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8
Note: Phase 4 depends on Phase 1 (not Phase 3), so Phases 3 and 4 could theoretically run in parallel.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Extension Scaffold & Config I/O | 0/4 | Not started | - |
| 2. Sidebar Environment View | 0/3 | Not started | - |
| 3. Tool Management | 0/3 | Not started | - |
| 4. Marketplace Registry & Discovery | 0/3 | Not started | - |
| 5. One-Click Install | 0/3 | Not started | - |
| 6. Profile System | 0/3 | Not started | - |
| 7. Configuration Panel | 0/3 | Not started | - |
| 8. Profile Portability & Polish | 0/2 | Not started | - |
