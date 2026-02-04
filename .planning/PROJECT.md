# Agent Config Keeper

## What This Is

A VS Code extension that provides a unified marketplace and management interface for agentic tools — skills, MCP servers, hooks, and slash commands. It replaces the fragmented workflow of browser-searching for tools, terminal-installing them, and manually toggling configs, with a single sidebar and rich UI that handles discovery, installation, configuration, and context-aware environment management.

## Core Value

Developers can discover, install, configure, and switch between sets of agent tools without leaving VS Code or touching config files manually.

## Requirements

### Validated

- Sidebar tree view showing current agent environment (skills, MCP servers, hooks, slash commands) -- v1.0
- File preview when clicking .md files in the sidebar tree -- v1.0
- "Configure Agent" panel with profile management (preset tool collections) -- v1.0
- Install/enable/disable/delete controls for each tool type -- v1.0
- "Marketplace" panel for discovering and installing tools -- v1.0
- GitHub-based registry for community-contributed tools -- v1.0
- Marketplace sources skills and MCP from GitHub, hooks and commands from community registry -- v1.0
- Profile system for switching between tool sets (e.g., "web dev", "data", "minimal") -- v1.0
- Global + per-project configuration (VS Code settings model) -- v1.0
- Claude Code as the v1 supported agent -- v1.0
- GitHub repo URL scanner for discovering tools in any repository -- v1.0
- Workspace-level profile auto-activation -- v1.0
- Profile import/export as shareable JSON bundles -- v1.0
- Professional UI with shared design tokens and accessible keyboard navigation -- v1.0

### Active

- [ ] Codex as a fully supported second agent with feature parity to Claude Code
- [ ] Agent switcher UX for selecting active agent (one agent active at a time)
- [ ] CodexAdapter for reading/writing Codex config files
- [ ] Sidebar, marketplace, install flows, and profiles all work with Codex
- [ ] Agent-specific profiles (each agent has its own profile set)

### Out of Scope

- Multi-agent support beyond Claude Code and Codex -- v1.1 adds Codex, other agents deferred
- Dedicated backend/API server for marketplace -- GitHub-based registry is sufficient
- Ratings/reviews system for marketplace listings -- defer until community grows
- Auto-detection of project type for tool suggestions -- future enhancement
- Tool authoring/publishing workflow from within the extension -- contributors use GitHub directly
- VS Code Settings Sync for profile syncing -- future enhancement

## Context

Shipped v1.0 with ~27,400 LOC TypeScript/CSS/JSON across 132 files.
Tech stack: VS Code Extension API, React (webviews), esbuild (dual build), Zod (validation).

Architecture: Agent-agnostic core with ClaudeCodeAdapter implementing all Claude Code-specific parsing/writing. Services use DI pattern. Two React webviews (marketplace, config panel) with shared CSS design system.

Key integrations: GitHub-based registry (ETag-cached), repo URL scanner, FileWatcher for external config changes.

Known areas for future work: additional agent adapters (Cursor, Copilot), advanced marketplace features (install counts, collections, update notifications), Settings Sync for profiles.

## Current Milestone: v1.1 Codex Support

**Goal:** Add OpenAI Codex as a fully supported second agent with feature parity to Claude Code, proving the agent-agnostic architecture.

**Target features:**
- CodexAdapter for reading/writing Codex config files
- Agent switcher UX (one active agent at a time, UI context-switches)
- Full sidebar, marketplace, install, and profile support for Codex
- Agent-specific profiles (each agent maintains its own profile set)

## Constraints

- **Platform**: VS Code extension (Extension API) — must work with VS Code's extension model
- **Agents**: Claude Code + Codex — reads/writes each agent's config files. Claude Code: skills in `~/.claude/skills` and `.claude/skills`, commands in `.claude/commands`, settings in `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, MCP in `~/.claude.json` and `.mcp.json`. Codex: config locations TBD (research needed).
- **Registry**: GitHub-based — a GitHub repository serves as the tool index/registry
- **Architecture**: Agent-agnostic internals — tool management layer must not be hard-coded to Claude Code, even though v1 only implements Claude Code adapters

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Claude Code first, other agents later | Most concrete tool ecosystem to target; user's primary agent | Good -- agent-agnostic adapter architecture ready for expansion |
| GitHub-based registry over dedicated backend | Simpler infrastructure, community familiarity, lower maintenance | Good -- ETag caching keeps API usage minimal |
| Profiles as first-class concept | Core pain point is context window management via tool set switching | Good -- diff-based switching works well |
| Global + per-project config model | Mirrors VS Code's own settings model; natural for developers | Good -- scope resolution chain works as expected |
| Zod schemas with .passthrough() | Preserve unknown fields in config files written by other tools | Good -- prevents data loss |
| Repo URL scanner over GitHub Search API | Phase 9 pivot: Search API too unreliable for tool discovery | Good -- user-controlled, no rate limit issues |
| Shared CSS with --ack-* namespace | Phase 11: consistent design tokens across webviews | Good -- theme-safe, accessible |
| Plain HTML buttons over vscode-button | Phase 11: vscode-button icon-only rendering broken in webviews | Good -- reliable cross-theme rendering |

---
*Last updated: 2026-02-03 after v1.1 milestone start*
