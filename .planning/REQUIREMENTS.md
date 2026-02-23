# Requirements: Agent Config Keeper

**Defined:** 2026-02-19
**Core Value:** Developers can discover, install, configure, and switch between sets of agent tools without leaving VS Code or touching config files manually.

## v1.2 Requirements

Requirements for v1.2 Copilot Support milestone. Each maps to roadmap phases.

### MCP — MCP Server Management

- [x] **MCP-01**: User can view workspace-scoped Copilot MCP servers (`.vscode/mcp.json`) in the sidebar
- [x] **MCP-02**: User can view user-scoped Copilot MCP servers (VS Code profile `mcp.json`) in the sidebar
- [x] **MCP-03**: User can install a Copilot MCP server from the marketplace
- [x] **MCP-04**: User can remove a Copilot MCP server from the sidebar
- [x] **MCP-05**: Sidebar refreshes automatically when `.vscode/mcp.json` is changed externally

### INST — Custom Instructions and Prompts

- [x] **INST-01**: User can view the always-on instructions file (`.github/copilot-instructions.md`) in the sidebar
- [x] **INST-02**: User can view file-pattern instruction files (`.github/instructions/*.instructions.md`) in the sidebar
- [x] **INST-03**: User can view prompt files (`.github/prompts/*.prompt.md`) in the sidebar
- [ ] **INST-04**: User can install instruction or prompt files from the marketplace
- [x] **INST-05**: User can delete instruction or prompt files from the sidebar
- [x] **INST-06**: User can preview instruction and prompt file content as markdown

### AGNT — Custom Agents

- [ ] **AGNT-01**: User can view custom agent files (`.github/agents/*.agent.md`) in the sidebar
- [ ] **AGNT-02**: User can enable or disable a custom agent (toggles `user-invokable` field in frontmatter)
- [ ] **AGNT-03**: User can install a custom agent from the marketplace
- [ ] **AGNT-04**: User can delete a custom agent from the sidebar
- [ ] **AGNT-05**: User can preview custom agent file content as markdown

### UX — Agent Switcher, Profiles, Marketplace

- [x] **UX-01**: User can select GitHub Copilot in the agent switcher (status bar QuickPick)
- [x] **UX-02**: Extension detects Copilot installation via VS Code Extension API (not filesystem)
- [x] **UX-03**: Sidebar, marketplace, and profile panel update to show Copilot tools when Copilot is active
- [ ] **UX-04**: User can create, switch between, and delete Copilot-specific profiles
- [ ] **UX-05**: User can export and import Copilot profiles as `.ackprofile` bundles
- [ ] **UX-06**: Marketplace shows only Copilot-compatible tools when Copilot is the active agent
- [ ] **UX-07**: Marketplace install routes correctly to CopilotAdapter when Copilot is active

## v1.3+ Requirements

Deferred to future releases. Tracked but not in current roadmap.

### Infrastructure

- Non-default VS Code profile path resolution for user MCP config — requires VS Code profile API investigation
- VS Code Insiders variant path support — `globalStorageUri` derivation handles this automatically; deferred until user reports
- Inline `mcp-servers` field in `.agent.md` frontmatter — read-only metadata only in v1.2, full support later

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| MCP server enable/disable toggle | Copilot has no `disabled` field in `mcp.json`; no config-level toggle exists (GitHub issue #246649 open) |
| Copilot hook system | Copilot has no programmable hook system equivalent to Claude Code's hooks |
| Copilot slash commands | Copilot has no slash command system; `.prompt.md` files are surfaced as prompts instead |
| Copilot Extensions (Marketplace extensions) | VS Code Copilot Extensions are a different system from MCP/agents; out of scope |
| VS Code settings.json integration | VS Code settings are managed by VS Code itself; not this extension's responsibility |
| Agent-level YAML array parsing in `.agent.md` | `tools` and `agents` arrays treated as opaque text in v1.2; write support deferred |
| Multi-agent support beyond Claude Code, Codex, Copilot | Future milestones |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| UX-01 | Phase 20 | Complete |
| UX-02 | Phase 20 | Complete |
| UX-03 | Phase 20 | Complete |
| MCP-01 | Phase 21 | Complete |
| MCP-02 | Phase 21 | Complete |
| MCP-03 | Phase 21 | Complete |
| MCP-04 | Phase 21 | Complete |
| MCP-05 | Phase 21 | Complete |
| INST-01 | Phase 22 | Complete |
| INST-02 | Phase 22 | Complete |
| INST-03 | Phase 22 | Complete |
| INST-04 | Phase 22 | Pending |
| INST-05 | Phase 22 | Complete |
| INST-06 | Phase 22 | Complete |
| AGNT-01 | Phase 23 | Pending |
| AGNT-02 | Phase 23 | Pending |
| AGNT-03 | Phase 23 | Pending |
| AGNT-04 | Phase 23 | Pending |
| AGNT-05 | Phase 23 | Pending |
| UX-04 | Phase 24 | Pending |
| UX-05 | Phase 24 | Pending |
| UX-06 | Phase 25 | Pending |
| UX-07 | Phase 25 | Pending |

**Coverage:**
- v1.2 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0

---
*Requirements defined: 2026-02-19*
*Last updated: 2026-02-19 after roadmap creation*
