# Agent Config Keeper

## What This Is

A VS Code extension that provides a unified marketplace and management interface for agentic tools — skills, MCP servers, hooks, slash commands, and custom prompts. It replaces the fragmented workflow of browser-searching for tools, terminal-installing them, and manually toggling configs, with a single sidebar and rich UI that handles discovery, installation, configuration, and context-aware environment management across multiple AI coding agents.

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
- Codex as a fully supported second agent with feature parity to Claude Code -- v1.1
- Agent switcher UX for selecting active agent (one agent active at a time) -- v1.1
- CodexAdapter for reading/writing Codex config files (TOML) -- v1.1
- Sidebar, marketplace, install flows, and profiles all work with Codex -- v1.1
- Agent-specific profiles (each agent has its own profile set) -- v1.1

### Active

(None — planning next milestone)

### Out of Scope

- Dedicated backend/API server for marketplace -- GitHub-based registry is sufficient
- Ratings/reviews system for marketplace listings -- defer until community grows
- Auto-detection of project type for tool suggestions -- future enhancement
- Tool authoring/publishing workflow from within the extension -- contributors use GitHub directly
- VS Code Settings Sync for profile syncing -- future enhancement
- Multi-agent support beyond Claude Code and Codex -- future milestones
- Codex hook system -- Codex has no programmable hook system equivalent to Claude Code's hooks
- TOML comment preservation (surgical editing) -- full parse/stringify sufficient; optimize if users report issues

## Context

Shipped v1.1 with ~23,400 LOC TypeScript/TSX/CSS across ~150 source files.
Tech stack: VS Code Extension API, React (webviews), esbuild (dual build), Zod (validation), smol-toml (TOML).

Architecture: Agent-agnostic core with IPlatformAdapter interface composed from 5 sub-interfaces. ClaudeCodeAdapter (JSON config) and CodexAdapter (TOML config) both implement IPlatformAdapter. ESLint boundary guard enforces that services/views never import adapter internals directly. Two React webviews (marketplace, config panel) with shared CSS design system.

Key integrations: GitHub-based registry (ETag-cached), repo URL scanner, FileWatcher for external config changes (per-adapter watch paths), AgentSwitcherService with globalState persistence.

Known tech debt: custom_prompt absent from marketplace type union; activeAgentName unused in marketplace App.tsx; switchProfile workspace override check not agent-scoped; fileWatcher closure ordering fragility in extension.ts activation.

## Constraints

- **Platform**: VS Code extension (Extension API) — must work with VS Code's extension model
- **Agents**: Claude Code + Codex — reads/writes each agent's config files. Claude Code: skills in `~/.claude/skills` and `.claude/skills`, commands in `.claude/commands`, settings in `~/.claude/settings.json` / `.claude/settings.json` / `.claude/settings.local.json`, MCP in `~/.claude.json` and `.mcp.json`. Codex: MCP servers in `~/.codex/config.toml` / `.codex/config.toml`, skills in `~/.codex/skills/` / `.codex/skills/`, prompts in `~/.codex/prompts/` (user scope only).
- **Registry**: GitHub-based — a GitHub repository serves as the tool index/registry
- **Architecture**: Agent-agnostic internals — tool management layer routes through IPlatformAdapter; ESLint boundary guard prevents direct adapter imports in services/views

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
| IPlatformAdapter composed from 5 sub-interfaces | v1.1: clean separation of tool, MCP, path, install, lifecycle concerns | Good -- each sub-interface independently implementable |
| smol-toml via lazy dynamic import | v1.1: ESM-only package in CJS project; avoid bundler complications | Good -- transparent to callers, cached after first load |
| MCP server ID includes 'codex' segment | v1.1: distinguishes Codex tools from Claude Code in shared data structures | Good -- enables correct adapter routing by ID inspection |
| $(copilot) codicon for status bar | v1.1: agent-agnostic icon recognizable to developers | Good -- renders correctly across themes |
| .ackprofile export format with agentId | v1.1: enables cross-agent import validation and conversion | Good -- version 2 schema backward-compatible |
| Empty agents array means all-agent compatible | v1.1: backward-compatible registry entry default | Good -- existing registry tools work without migration |
| Agent filtering before type filtering in marketplace | v1.1: ensures type tabs only show types relevant to active agent | Good -- consistent UX across agent switches |
| Profiles scoped per-agent with migration | v1.1: clean isolation; v1 profiles attributed to claude-code on first run | Good -- no data loss, transparent to user |

---
*Last updated: 2026-02-18 after v1.1 milestone completion*
