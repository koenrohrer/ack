# Changelog

All notable changes to ACK are documented here.

---

## 1.0.0

Initial public release.

### Core Infrastructure

- VS Code extension scaffold with esbuild bundling and TypeScript
- Internal type system, Zod schemas, and config validation
- FileIO and backup services with atomic writes
- Claude Code adapter with per-platform path resolution
- Config service with scope resolution (user vs. project) and safe write pipeline

### Tool Tree Sidebar

- Tree data provider displaying MCP servers, slash commands, hooks, and skills
- Grouped by type, labeled by scope (user / project)
- Status icons: enabled (green), disabled (gray), warning (yellow), error (red)
- Dark and light theme icon variants
- Welcome view when no tools are found
- File watcher with debounced refresh on external config changes

### Tool Management

- Toggle tools enabled/disabled inline
- Move tools between user and project scope
- Delete tools with optional confirmation dialog
- Open the source config file for any tool
- Type-aware writer modules for each tool kind

### Marketplace

- React webview panel for browsing a community tool registry
- Search, filter by type, sort by relevance or date
- Tool detail view with full description and configuration form
- One-click install to user or project scope
- Registry service with ETag caching for efficient fetches
- GitHub repository scanner for user-added tool repos

### Profiles

- Create, edit, delete, and switch named tool profiles
- Save current tool state as a profile
- Diff-based batch toggle on profile switch
- Auto-sync tool changes to active profile
- Import and export profiles as JSON files
- Workspace association with automatic activation on open

### Config Panel

- React webview for editing Claude Code settings
- Model selection, permissions, and custom instructions as form fields
- MCP server environment variable editing
- Profile list and editor integrated into the panel
- Tool settings tab with live state management

### UI Polish

- Shared CSS design tokens across all webviews
- Focus-visible outlines and keyboard accessibility
- Transitions and hover states on interactive elements
- Stroke-based activity bar icon
- Codicon stylesheet integration for consistent VS Code styling

### Security

- Path traversal protection in install service
- Input validation through Zod schemas at system boundaries

### Bug Fixes

- Module resolution order for marked/dompurify compatibility
- Registry error handling and default registry source
- Normalized `contentPath` to prevent double-slash in registry URLs
- Write service injection into adapter for uninstall
- Tool name normalization for marketplace install/uninstall matching
- Stash-based hook toggle replacing non-functional disabled field
- Profile tool count reconciliation against current environment
- Disabled status detection for skills and commands in parsers
- Tree refresh after toggle to reflect disabled status
- Back button rendering in webview navigation
- Profile save-and-apply flow
- Restart tool disable state
- Button text labels and tree refresh on tool state changes
- Delete confirmation moved to extension host for reliability
- ESLint config scoped to exclude test files
- GitHub search rewritten to use repo URL scanner after API limitations
