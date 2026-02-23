# Roadmap: Agent Config Keeper

## Milestones

- v1.0 MVP - Phases 1-11 (shipped 2026-02-03)
- v1.1 Codex Support - Phases 12-19 + UAT (shipped 2026-02-18)
- v1.2 Copilot Support - Phases 20-25 (in progress)

## Phases

<details>
<summary>v1.0 MVP (Phases 1-11) - SHIPPED 2026-02-03</summary>

See `.planning/milestones/v1.0-ROADMAP.md` for full phase details.

11 phases, 33 plans, 83 commits. All 27 requirements delivered.

</details>

<details>
<summary>v1.1 Codex Support (Phases 12-19 + UAT) - SHIPPED 2026-02-18</summary>

See `.planning/milestones/v1.1-ROADMAP.md` for full phase details.

9 phases, 22 plans. All 34 requirements delivered. 31-test UAT passed.

</details>

### v1.2 Copilot Support (In Progress)

**Milestone Goal:** GitHub Copilot added as a fully supported third agent with feature parity to Claude Code and Codex — MCP servers, custom instructions, custom agents, agent-scoped profiles, and marketplace routing all work for Copilot users.

#### Phase 20: CopilotAdapter Scaffold
**Goal**: Copilot is a selectable agent in the extension and the adapter foundation is in place for all subsequent config reading and writing
**Depends on**: Phase 19 (existing adapter architecture)
**Requirements**: UX-01, UX-02, UX-03
**Success Criteria** (what must be TRUE):
  1. User can select "GitHub Copilot" in the agent switcher status bar QuickPick
  2. Copilot only appears as an option when the GitHub Copilot VS Code extension is installed
  3. Switching to Copilot updates the sidebar, marketplace, and profile panel to the Copilot context (all surfaces reflect the active agent)
  4. ESLint boundary guard covers `**/adapters/copilot/*` so no service or view can import adapter internals directly
  5. Marketplace `configDir` conditional no longer hard-codes `.claude` as the Copilot fallback
**Plans**: 2 plans

Plans:
- [ ] 20-01-PLAN.md — CopilotAdapter scaffold: create CopilotPaths module, CopilotAdapter class, and register in extension.ts
- [ ] 20-02-PLAN.md — Platform wiring: ESLint boundary guard, QuickPick hide behavior, marketplace configDir fix

#### Phase 21: MCP Server Support
**Goal**: Users can manage Copilot MCP servers at both workspace and user scope from the sidebar and marketplace
**Depends on**: Phase 20
**Requirements**: MCP-01, MCP-02, MCP-03, MCP-04, MCP-05
**Success Criteria** (what must be TRUE):
  1. User can see all Copilot MCP servers currently defined in `.vscode/mcp.json` listed in the sidebar under the Copilot environment
  2. User can see user-scoped MCP servers from the VS Code profile `mcp.json` in the sidebar
  3. User can install a Copilot MCP server from the marketplace with one click and have it written to `.vscode/mcp.json` using the correct `servers` key
  4. User can remove a Copilot MCP server from the sidebar and have it deleted from the config file
  5. When `.vscode/mcp.json` is edited externally, the sidebar refreshes automatically without restarting the extension
**Plans**: 4 plans

Plans:
- [ ] 21-01-PLAN.md — Copilot MCP schema, parser (reads `servers` key), and writer (add/remove with inputs preservation)
- [ ] 21-02-PLAN.md — Wire CopilotAdapter MCP methods + register copilotSchemas in extension.ts + fix getJsonPath for Copilot
- [ ] 21-03-PLAN.md — TDD: Copilot MCP parser and writer tests (servers key, inputs preservation, missing file, wrong key pitfalls)
- [ ] 21-04-PLAN.md — Human verification checkpoint: all five MCP requirements end-to-end in running extension

#### Phase 22: Custom Instructions and Prompts
**Goal**: Users can browse, preview, install, and delete Copilot instruction and prompt files from the sidebar
**Depends on**: Phase 20
**Requirements**: INST-01, INST-02, INST-03, INST-04, INST-05, INST-06
**Success Criteria** (what must be TRUE):
  1. User can see `.github/copilot-instructions.md` listed in the sidebar as the always-on instructions file
  2. User can see all `.github/instructions/*.instructions.md` files listed in the sidebar with their `applyTo` scope
  3. User can see all `.github/prompts/*.prompt.md` files listed in the sidebar
  4. User can install instruction or prompt files from the marketplace and have them written to the correct `.github/` location
  5. User can delete any instruction or prompt file from the sidebar and preview its markdown content inline
**Plans**: 4 plans

Plans:
- [ ] 22-01-PLAN.md — Instructions + prompts parsers: create instructions.parser.ts and prompts.parser.ts; wire CopilotAdapter.readTools() for CustomPrompt; extend APPLICABLE_SCOPES to include Project
- [ ] 22-02-PLAN.md — TDD: Copilot instructions and prompts parser tests (no-frontmatter, missing dir, compound extensions, applyTo, mode/agent aliasing)
- [ ] 22-03-PLAN.md — Delete and file-install: CopilotAdapter.removeTool() for CustomPrompt; extend ack.deletePrompt; add ack.installInstructionFromFile command; package.json menu entries
- [ ] 22-04-PLAN.md — Marketplace install + human verification: CopilotAdapter.installInstruction(); custom_prompt branch in handleRepoInstall; INST-01 through INST-06 end-to-end checkpoint

#### Phase 23: Custom Agents
**Goal**: Users can browse, toggle, install, delete, and preview Copilot custom agent files from the sidebar
**Depends on**: Phase 22
**Requirements**: AGNT-01, AGNT-02, AGNT-03, AGNT-04, AGNT-05
**Success Criteria** (what must be TRUE):
  1. User can see all `.github/agents/*.agent.md` files listed in the sidebar with their enabled/disabled state
  2. User can toggle the `user-invokable` field of a custom agent from the sidebar and have the frontmatter updated in the file immediately
  3. User can install a custom agent from the marketplace and have it written to `.github/agents/`
  4. User can delete a custom agent from the sidebar and preview its markdown content inline
**Plans**: TBD

Plans:
- [ ] 23-01: TBD

#### Phase 24: Agent-Scoped Profiles
**Goal**: Copilot has its own profile set where users can create, switch, delete, export, and import profiles that capture MCP servers and agent states
**Depends on**: Phase 21, Phase 22, Phase 23
**Requirements**: UX-04, UX-05
**Success Criteria** (what must be TRUE):
  1. User can create a named Copilot profile, switch between Copilot profiles, and delete a Copilot profile without affecting Claude Code or Codex profiles
  2. Switching Copilot profiles applies the correct MCP server configuration and agent `user-invokable` state to the workspace
  3. User can export a Copilot profile as an `.ackprofile` bundle and import it on another machine or workspace, restoring the full tool set
**Plans**: TBD

Plans:
- [ ] 24-01: TBD

#### Phase 25: Marketplace Routing
**Goal**: The marketplace surfaces only Copilot-compatible tools when Copilot is active and routes installs correctly to the CopilotAdapter
**Depends on**: Phase 21, Phase 22, Phase 23
**Requirements**: UX-06, UX-07
**Success Criteria** (what must be TRUE):
  1. When Copilot is the active agent, the marketplace shows only tools tagged as Copilot-compatible (MCP servers, instructions, agents) and hides Claude Code and Codex-only tools
  2. Clicking "Install" on a Copilot-compatible tool in the marketplace routes the install to `CopilotAdapter` and writes the tool to the correct Copilot config location
**Plans**: TBD

Plans:
- [ ] 25-01: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 12. Adapter Purification | v1.1 | 2/2 | Complete | 2026-02-03 |
| 13. Codex Foundation | v1.1 | 3/3 | Complete | 2026-02-04 |
| 14. Agent Switcher | v1.1 | 2/2 | Complete | 2026-02-04 |
| 15. Codex MCP Servers | v1.1 | 3/3 | Complete | 2026-02-04 |
| 16. Codex Skills | v1.1 | 2/2 | Complete | 2026-02-04 |
| 17. Codex Custom Prompts | v1.1 | 2/2 | Complete | 2026-02-05 |
| 18. Agent-Scoped Profiles | v1.1 | 5/5 | Complete | 2026-02-05 |
| 19. Marketplace Adaptation | v1.1 | 2/2 | Complete | 2026-02-05 |
| v1.1-full-uat. UAT Gap Closure | v1.1 | 1/1 | Complete | 2026-02-17 |
| 20. CopilotAdapter Scaffold | 2/2 | Complete    | 2026-02-21 | - |
| 21. MCP Server Support | 4/4 | Complete    | 2026-02-21 | - |
| 22. Custom Instructions and Prompts | 3/4 | In Progress|  | - |
| 23. Custom Agents | v1.2 | 0/TBD | Not started | - |
| 24. Agent-Scoped Profiles | v1.2 | 0/TBD | Not started | - |
| 25. Marketplace Routing | v1.2 | 0/TBD | Not started | - |
