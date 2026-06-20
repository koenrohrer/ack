# ACK 2.0 — Phased Implementation Plan

**Status:** Draft for review (no code written yet)
**Date:** 2026-06-20
**Scope:** Remove the community marketplace; make provider support cleanly pluggable.
**Baseline:** `koenrohrer/ack` v1.3.1

---

## 0. Orientation (what the current codebase actually is)

Top-level structure under `src/`:

| Area | Contents | 2.0 disposition |
|---|---|---|
| `adapters/` | `adapter.registry.ts`, `claude-code/`, `codex/`, `copilot/`, `shared/` | **Keep** — this *is* the provider seam |
| `types/` | `adapter*.ts` (the interface), `config.ts`, `enums.ts` | **Keep** |
| `services/` | config, fileio, backup, schema, tool-manager, profile, workspace-profile, agent-switcher | **Keep** |
| `services/` (marketplace) | `registry.*`, `repo-scanner.*`, `install.*` | **Drop / rework** |
| `views/` | tool-tree, config-panel, agent-switcher, file-watcher, shared | **Keep** |
| `views/marketplace/` | panel + webview (12 components) | **Delete entirely** |
| `utils/` | json, markdown, platform, tool-key | **Keep** |

**Key finding:** the provider/adapter abstraction 2.0 asks for **already exists and is reasonably clean.** `IPlatformAdapter` (`src/types/adapter.ts`) is composed from focused sub-interfaces — `IToolAdapter` (discovery + CRUD + toggle), `IMcpAdapter`, `IPathAdapter`, `IInstallAdapter` (install local content), `ILifecycleAdapter` (detection + watch paths) — and `AdapterRegistry` already does register/lookup/active-selection/detect. Claude Code, Codex, and Copilot are already providers behind it; `extension.ts` registers them by iterating a single array.

This means 2.0 is best done as an **in-place refactor (delete marketplace + harden the seam)**, not a parallel greenfield rewrite.

---

## 1. Decisions (resolved 2026-06-20)

1. **In-place refactor — not a parallel greenfield rewrite.** ✅ The core seam exists, is tested, and works across three agents; a rewrite re-derives subtle, correct logic (Codex TOML, Copilot paths, profile migration) for little gain and real risk. Phase 1 = delete + unwire, not scaffold-a-new-core.
2. **`ack.installTool` (group "+") → local install.** ✅ Repurpose it to a local file/folder picker reusing `provider.installSkill/installCommand/installMcpServer`. **Local-install scope: skills (folder), commands (file/folder), custom prompts/instructions (file), MCP servers (guided input). Hook import is out of scope** — hooks stay toggleable/deletable/editable in-file. (Note: this makes local install a *new* capability for Claude Code, which has none today.)
3. **Naming — full rename to provider vocabulary.** ✅ The abstraction becomes `AgentProvider`, and the whole codebase moves to one word: `ProviderRegistry`, `ClaudeCodeProvider`/`CodexProvider`/`CopilotProvider`, `src/providers/`, `provider`/`activeProvider` variables, the internal context key `ack.activeAdapterId` → `ack.activeProviderId` (coordinated with the package.json `when`-clauses), and tests/mocks/docs. Carried out as an isolated, logic-free rename in **Phase 5**, sequenced last so it never tangles with a behavioral diff. **Exception:** the persisted profile field `agentId` stays — it identifies the external *agent* (Claude Code/Codex/Copilot), not the provider object, and renaming it would force a stored-state migration. *(Convention: this plan uses **provider** vocabulary for the concept, but quotes current code symbols by their present names — `IPlatformAdapter`, `AdapterRegistry`, `src/adapters/`, `*.adapter.ts`, `adapter.id`, `ack.activeAdapterId`, the `types/adapter-*.ts` files — because that is what exists on disk through Phases 1–4. The Phase 5 rename map gives the old→new mapping.)*
4. **Phase 4 (seam hardening) ships in 2.0, sequenced last.** ✅ It is the heart of the "pluggable" goal, so it is in-scope — but it is the largest blast radius and cleanly separable, so it is the first thing to defer to 2.1 if a cut is needed.
5. **Obsolete settings left inert.** ✅ `ack.userRepositories` / `ack.registrySources` are dropped from the manifest; existing user values are ignored by VS Code (no migration code), noted in the CHANGELOG.

---

## 1a. Verification findings (against source, 2026-06-20)

The plan was pressure-tested file-by-file before execution. Most claims held; the corrections below are folded into the phases.

**Confirmed:** seam composition (`src/types/adapter.ts:24`), `AdapterRegistry` register/lookup/active/detect (`src/adapters/adapter.registry.ts:13`); all deletion targets exist; `marked`/`dompurify` are marketplace-only (sole hits `ToolDetailView.tsx:2,3,57,60`); Phase 4 leak claims 1–5 (Codex TOML `tool-tree.management.ts:25-28,398,511,575,677`; `instanceof CodexAdapter` `extension.ts:104`; `config-panel.panel.ts:589-590`; duck-typing `install.service.ts:40,50`; 10× `ack.activeAdapterId ==` in `package.json`). The `agentId` exception is sound — `adapter.id` *values* equal the persisted `agentId` values, so the Phase 5 rename is symbol-only with no data migration.

**Corrections folded in:**
1. **Component count is 12, not 13** (orientation table + §2).
2. **Phase 4 verify grep was incomplete** — it missed `!== 'codex'/'copilot'` (`tool-tree.management.ts:235,720,828`), `CodexPaths`/`CopilotPaths` imports (`:741,:856`; `extension.ts:13`), and `package.json` (not under `src/`). Gate broadened in Phase 4.
3. **Local-install scope is per-provider, not flat** — `Codex`/`Copilot` `installCommand` *throw* `AdapterScopeError`; Claude Code has no custom-prompt installer and `CustomPrompt ∉ supportedToolTypes`. Matrix added to Phase 2; the picker must gate on provider capability.
4. **`marketplace-filters__tab` CSS coupling** — `config-panel/webview/App.tsx:122,149` use a class defined only in the to-be-deleted `marketplace.css`. CSS extraction pulled into Phase 1 (was Phase 5 cosmetic).
5. **Phase 2 ⇄ Phase 4 overlap** — formalizing `installCustomPrompt`/`installInstruction` onto `IInstallAdapter` (Phase 2) *is* the install-side duck-typing removal (Phase 4). Done once in Phase 2; Phase 4 narrowed to MCP/lifecycle/`instanceof`.
6. **`LocalInstallService` is net-new, not "slim"** — `install.service.test.ts` is ~37K, and manifest validation (`ToolManifestSchema`) / env-var prompting / config-field handling must be preserved for the MCP guided-input path.

**Acceptable, left as-is:** hardcoded `'claude-code'` migration defaults (`profile.service.ts:90`, `workspace-profile.service.ts:103`, `tool-tree.profile-commands.ts:294`) are legacy `agentId` anchors — whitelisted in the Phase 4 grep, not removed. `marketplace.panel.ts:824-829` `CONFIG_DIR_LABELS` leak is mooted by Phase 1 deletion.

---

## 2. Inventory — the marketplace removal targets

**Delete outright**
- `src/views/marketplace/` (panel, messages, webview App + 12 components + 3 hooks + styles).
- `src/services/registry.service.ts`, `registry.types.ts` (100% remote GitHub registry fetch).
- `src/services/repo-scanner.service.ts`, `repo-scanner.types.ts` (100% remote `api.github.com` / `raw.githubusercontent.com`).
- Tests: `src/test/unit/registry.service.test.ts`, `repo-scanner.service.test.ts`.
- Asset: `media/screenshots/marketplace.png`.

**Rework (registry-sourcing is the only marketplace part)**
- `src/services/install.service.ts` + `install.types.ts` — core install methods fetch content via `registryService.fetchToolFile`; `ToolManifest` is a registry concept. Replace with a local install path that reads from disk and delegates to the provider.

**`package.json` removals**
- Command `ack.openMarketplace` + its `view/title` menu entry.
- Settings `ack.userRepositories`, `ack.registrySources`.
- Dependencies `marked`, `dompurify`, devDependency `@types/dompurify` (confirmed marketplace-only — sole use is `ToolDetailView.tsx`).
- Bump `version` → `2.0.0`; revise `description`/`keywords` (drop store framing).

**Build**
- `esbuild.webview.mjs` — remove the `src/views/marketplace/webview/index.tsx → dist/webview.js` entry (config-panel webview stays).

**Unwire**
- `src/extension.ts` — RegistryService/InstallService/RepoScannerService/MarketplacePanel imports + construction; `registryService` field in the `services` container (consumed only by marketplace); `ack.openMarketplace`; `MarketplacePanel.notifyAgentChanged`; the "Open Marketplace" action in `handleWorkspaceAutoActivation` step 10.
- `src/views/tool-tree/tool-tree.management.ts` — `MarketplacePanel` import; `ack.installTool` body; marketplace params.
- `src/views/tool-tree/tool-tree.profile-commands.ts` — `registryService`/`installService` params and the **only** marketplace block: `ack.importProfile`'s "missing tools → install from marketplace?" (~lines 612–664).

**Docs (not code):** README (12 refs), USAGE (9), CHANGELOG (16 — keep history, add 2.0 entry), CONTRIBUTING (2).

> ⚠️ **Do NOT touch** `.github/RELEASING.md` / `.github/workflows/release.yml`. Their "Marketplace" = **Visual Studio Marketplace** (extension publishing), unrelated to ACK's tool marketplace.

---

## 3. Capabilities that must survive → seam mapping

| Survives | Today | 2.0 home |
|---|---|---|
| Sidebar tool-discovery tree | `views/tool-tree/**` ← `IToolAdapter.readTools` | Unchanged |
| Switch active agent/provider | `agent-switcher.service` + `AdapterRegistry` + `ILifecycleAdapter.detect` | Unchanged |
| Per-agent profiles | `profile.service` (keyed by `agentId`) + profile commands | Keep; sever marketplace import-install branch only |
| Install/toggle tools from **local** sources | toggle: `IToolAdapter.toggleTool`; install: today via marketplace | toggle unchanged; **install reworked to local → `IInstallAdapter`** |

Profiles stay a shared, agent-agnostic service scoped by `agentId` (not pushed per-provider).

---

## 4. Where the provider seam leaks today (the "make it pluggable" work)

1. **`tool-tree.management.ts` writes Codex TOML directly** — `addMcpServer`, `toggleMcpTool`, `addEnvVar`, `editEnvVar`, `removeEnvVar` gated on `adapter.id === 'codex'` and mutate via `configService.writeTomlConfigFile<CodexConfig>` with a locally redeclared `CodexConfig`. `installPromptFromFile` (`=== 'codex'`) and `installInstructionFromFile` (`=== 'copilot'`) import `CodexPaths`/`CopilotPaths` directly.
2. **`extension.ts` special-cases Codex** — `instanceof CodexAdapter`, `handleCodexNotifications`, `ack.initCodexProject` (imports `CodexPaths`), `ack.codexConfigDismissed`.
3. **`config-panel.panel.ts:590`** writes TOML directly (Codex MCP editing).
4. **`install.service.ts`** duck-types capabilities (`hasInstructionInstaller`, `hasCustomPromptInstaller`); **`package.json` menus** hard-code `ack.activeAdapterId == codex|copilot`.

---

## 5. Phased plan

### Phase 0 — Baseline & safety net
- **Goal:** Lock in current behavior.
- **Work:** Run + record green: `check-types`, `lint`, `test:unit`, `compile`, `package`. Branch `2.0-core`. **Supply-chain (§5a):** move installs to `npm ci --ignore-scripts` (verify the build still works; allowlist any package that truly needs a script — esbuild ≥0.24 does not); confirm `package-lock.json` is committed.
- **Verify:** full gate passes; baseline saved; a fresh `npm ci --ignore-scripts` still builds + tests green.

### Phase 1 — Remove the marketplace (delete + unwire), keep build green
- **Status:** ✅ Complete (2026-06-20). Gate green (check-types/lint/compile/package pass; **316** unit tests, down from 369 = −10 registry −2 repo-scanner −41 install, exactly accounted). 31 files deleted (21 marketplace + 6 services + 3 tests + `marketplace.png`), 10 modified. `grep -rin marketplace src` → 0; dangling-ref grep → 0; no `dist/webview.js`. Extension bundle 930.8kb → 857.3kb. **Remaining:** F5 manual smoke (cannot run headless) — left to the user.
- **Goal:** Marketplace code/deps/commands/settings/build-entry/assets fully gone; tree/profiles/agent-switch still work.
- **Work:** **First** rescue the shared CSS: `config-panel/webview/App.tsx:122,149` use `marketplace-filters__tab`, defined only in `marketplace.css`; move those rules into `config-panel.css` under a config-panel-owned class and update the two `className`s, so config-panel tab styling survives the delete. Then delete marketplace dirs/services/tests/asset (§2); unwire `extension.ts`; stub `ack.installTool`; convert profile-import missing-tools to report-and-skip; strip `package.json` + `esbuild.webview.mjs`; `npm install --ignore-scripts` (refreshes the lockfile after the dep removals). **Deviation from §2:** `install.service.ts` / `install.types.ts` / `install.service.test.ts` were *deleted* here (not deferred to Phase 2 "rework") because `install.types.ts` imports `RegistrySource` from the deleted `registry.types.ts` and the test imports the deleted service — transitively coupled, so they had to go for the build to stay green. Phase 2's net-new module lifts `ToolManifestSchema`/`ConfigField`/safe-path validators from git history. Also done early (was Phase 5 cosmetic): the `ToolList.tsx` "Visit the Marketplace" empty-state copy → "No tools installed yet."
- **Files:** `config-panel/webview/App.tsx`, `config-panel/webview/styles/config-panel.css`, `extension.ts`, `tool-tree.management.ts`, `tool-tree.profile-commands.ts`, `package.json`, `package-lock.json`, `esbuild.webview.mjs`, deletions.
- **Verify:** `grep -ri marketplace src` → 0 hits (the CSS class is renamed here too, so the only survivors would be Phase-5 cosmetic copy if any remain); full gate passes; F5 → tree lists tools, agent switch + profile switch work, **config-panel tabs render styled**; no `dist/webview.js`.

### Phase 2 — Local-only tool install
- **Status:** ✅ Complete (2026-06-20). **Scope (decided): skills + commands now; MCP deferred to Phase 4; custom-prompt/instruction keep their existing dedicated installers** (`installPromptFromFile`/`installInstructionFromFile`). Created `services/local-install.utils.ts` (pure: `readDirFiles`, `resolveInstallScopes` via capability-probe with a workspace fallback, `buildInstalledMessage`) + `services/local-install.service.ts` (vscode dialogs; the project has no vscode test mock, so logic was split out the same way `tool-tree.command-utils.ts` is). `ack.installTool` installs by group tool type and its two menu `when`-clauses are restricted to `group:skill || group:command`. Tests: `local-install.utils.test.ts` (named for the module it covers, not the planned `*.service.test.ts`). Gate green: **327** unit tests (+11), compile/package clean. F5 smoke pending (user). **Carry-over to Phase 4:** Copilot's `getSkillsDir` still throws while `installSkill` works (the scope-probe tolerates this via fallback); the unified MCP "+" lands when add-MCP moves behind the MCP seam.
- **Goal:** Restore install of individual tools from local disk through the provider seam; no remote.
- **Work:** Replace `InstallService` with a **net-new** `LocalInstallService` (file/folder picker → read → `provider.install*`) — not a thin wrapper: it must carry over manifest validation (`ToolManifestSchema`), env-var prompting, and config-field handling from the old service for the MCP guided-input path, dropping only the `registryService.fetchToolFile` remote layer. Repurpose `ack.installTool` to branch by tool type **and** gate options on what the active provider actually supports (see matrix). **Formalize** `installCustomPrompt`/`installInstruction` onto `IInstallAdapter` here (this subsumes the Phase 4 install-side duck-typing removal — see Decision 5 / §1a finding 5), and add `installCustomPrompt` to `ClaudeCodeAdapter` only if Claude Code custom-prompt install is in scope (today it is not — `CustomPrompt ∉ supportedToolTypes`).
- **Per-provider install matrix (gate the picker on this; `installCommand` *throws* on Codex/Copilot):**

  | tool type | Claude Code | Codex | Copilot |
  |---|---|---|---|
  | skill (folder) | ✅ | ✅ | ✅ |
  | command (file/folder) | ✅ | ❌ throws | ❌ throws |
  | prompt/instruction (file) | ❌ none today | ✅ `installCustomPrompt` | ✅ `installInstruction` |
  | MCP (guided input) | ✅ | ✅ | ✅ |

  The "+" affordance must offer only the rows marked ✅ for the active provider — surfacing a ❌ option means an `AdapterScopeError` at click time.
- **Files:** new `services/local-install.service.ts` (+ new `local-install.types.ts` if needed — note `install.service.ts`/`install.types.ts`/`install.service.test.ts` were already deleted in Phase 1; recover `ToolManifestSchema`/`ConfigField`/safe-path validators from git history rather than re-deriving), `tool-tree.management.ts`, `types/adapter-install.ts`, three adapters, and a fresh `local-install.service.test.ts` (the old 37K install test is gone — write focused tests for the local path).
- **Verify:** new tests pass; F5 → local skill install into Claude Code (appears + toggles), Codex prompt + Copilot instruction install via same affordance, **command option absent for Codex/Copilot**, custom-prompt option absent for Claude Code; no network in install path.

### Phase 3 — Decouple profiles & workspace auto-activation from marketplace
- **Status:** ✅ Complete (2026-06-20). The behavioral report-and-skip already landed in Phase 1 (both `ack.importProfile` and `handleWorkspaceAutoActivation` step 10). Phase 3 verified the profile path has **zero** network/remote references (every "registry" match is the in-memory `AdapterRegistry`; no `fetch`/`http`/`installService`/`marketplace`) and repointed the two missing-tools messages at the new local-install "+" rather than the removed marketplace. No dedicated profile test file exists, so the full unit suite covers it. Gate green (327 tests). F5 (import a profile with an absent tool → clean skip, no network) pending (user).
- **Goal:** Profiles fully local; missing tools reported, never remotely fetched.
- **Work:** Finalize `ack.importProfile` missing-tools as report-and-skip (optional local-install follow-up); `handleWorkspaceAutoActivation` step 10 → plain warning.
- **Files:** `tool-tree.profile-commands.ts`, `extension.ts`.
- **Verify:** profile tests pass; F5 → import profile with absent tool → clean skip, no network; all profile commands work.

### Phase 4 — Harden the provider seam
- **Status:** ✅ Complete (2026-06-20). All sub-steps 4a–4f landed. Broadened verify grep = **0** (`src` excl. `adapters/`: no `=== '(codex|copilot)'`/`!==`/`==`, no `instanceof Codex/Claude/Copilot`, no `CodexConfig`, no `CodexPaths`/`CopilotPaths`, no `hasInstructionInstaller`/`hasCustomPromptInstaller`); **0** provider-literal `package.json` `when`-clauses. Capability model = optional `capabilities` descriptor (`resolveCapabilities` fills off-defaults) + optional `IMcpAdapter` methods (`setMcpEnvVar`/`removeMcpEnvVar`/`toggleMcpServerTool`) + optional `IInstallAdapter.installCustomPromptFile` + `ILifecycleAdapter` `getCommands`/`checkConfiguration` hooks; `ack.cap.*` context keys (set on activation + agent switch) drive the menus. Codex MCP env/toggle, prompt-install, and config-notifications/init all moved into `CodexAdapter` — which loads vscode lazily via `await import('vscode')` (type-only top-level import) so `adapter.test.ts` can still import it. Unified MCP "+" now works for every MCP-capable provider (dropped Codex's `enabled: true`; enabled-by-default holds for all). Removed dead marketplace plumbing orphaned by Phase 1 (`installCustomPrompt`/`getCustomPromptInstall*` on Codex, `installInstruction` on Copilot). **config-panel.panel.ts:590 left as-is** — reassessed as capability-driven (`getMcpConfigFormat()`, provider-agnostic `applyMcpEnvUpdate`), not an `adapter.id` leak. Gate green: **332** unit tests (+5), compile/package clean. F5 smoke pending (user).
- **Plan (confirmed 2026-06-20): full scope 4a–4f; capability model = descriptor + optional methods.** Add `readonly capabilities: { mcpEnvVars; mcpServerToolToggle; customPromptFileInstall }` to `IPlatformAdapter`; behavior methods are optional on `IMcpAdapter`/`IInstallAdapter`, present iff the flag is set. `extension.ts` maps capabilities → `ack.cap.*` context keys (on activation + agent switch); `package.json` `when`-clauses use those keys. Sub-steps, build-green between each:
  - **4a** MCP env-var + per-tool-toggle → `IMcpAdapter` (move the 4 `writeTomlConfigFile<CodexConfig>` mutations from `management.ts` + the `config-panel.panel.ts:590` write into `CodexAdapter`; delete the local `CodexConfig`).
  - **4b** prompt/instruction file install → `IInstallAdapter` (`installCustomPromptFile`; move `CodexPaths`/`CopilotPaths` into the adapters; un-gate the two commands). *(This is the install-side duck-typing removal — Phase 2 was scoped to skills+commands and deferred it to here.)*
  - **4c** capability `ack.cap.*` context keys + rewrite the 10 `package.json` `when`-clauses.
  - **4d** `extension.ts` Codex lifecycle behind an optional `onActivate(ctx)` hook (move `handleCodexNotifications` + `initCodexProject` into `CodexAdapter`; drop `instanceof CodexAdapter`, the `CodexPaths` import, `ack.codexConfigDismissed`).
  - **4e** unified MCP "+" for all providers (un-gate `addMcpServer`, wire the MCP-group "+") — the MCP install carry-over from Phase 2.
  - **4f** `adapter.test.ts` + mock updates; broadened verify grep = 0.
- **Work:** Move Codex env-var/add-MCP/per-tool-toggle behind `IMcpAdapter`; move Codex detection-notifications/init (incl. the `CodexPaths` module import and the `'~/.codex/config.toml'` copy at `extension.ts:13,487`) behind a lifecycle hook; replace remaining MCP/path duck-typing and `instanceof` with declared capability flags; clean the direct TOML write at `config-panel.panel.ts:589-590`; reduce `when`-clause `adapter.id` literals. *(Install-side prompt/instruction formalization was deferred from Phase 2 — it is sub-step 4b here.)*
- **Files:** `types/adapter-*.ts`, three adapters, `tool-tree.management.ts`, `extension.ts`, `config-panel.panel.ts`, `package.json` menus, `adapter.test.ts`.
- **Verify (broadened gate — the original grep missed `!==`, `CodexPaths`/`CopilotPaths`, and `package.json`):**
  - `grep -rEn "(===|!==|==|!=) ?'?(codex|copilot)'?|CodexConfig|CodexPaths|CopilotPaths|hasInstructionInstaller|hasCustomPromptInstaller|instanceof (Codex|Claude|Copilot)" src` (excl. `adapters/`) → 0.
  - `grep -En "ack.activeAdapterId" package.json` → only generic, non-provider-literal `when`-clauses remain (or 0).
  - The three `'claude-code'` migration defaults (`profile.service.ts`, `workspace-profile.service.ts`, `tool-tree.profile-commands.ts`) are **whitelisted** — legacy `agentId` anchors, not leaks.
  - All flows work; provider tests pass. *(Per Decision 4: in 2.0, sequenced last; first to defer to 2.1 if a cut is needed.)*

### Phase 5 — Provider rename + cosmetic cleanup
- **Status:** ✅ Complete (2026-06-20). Comprehensive rename to provider vocabulary via `git mv` + ordered `sed`: `IPlatformAdapter`→`AgentProvider`; sub-interfaces→`ToolCapability`/`McpCapability`/`PathCapability`/`InstallCapability`/`LifecycleCapability`; `AdapterRegistry`→`ProviderRegistry`; `*Adapter` classes→`*Provider`; dir `src/adapters/`→`src/providers/` and `*.adapter.ts`→`*.provider.ts`; **all** `types/adapter*.ts`→`types/provider*.ts` including the error classes (`AdapterError`/`AdapterScopeError`/… → `Provider*Error`) — judgment call for full consistency with Decision 3's "one word"; `getActiveAdapter`/`getAllAdapters`/`getAdapter`→`getActive/All/Provider`; vars `adapter`/`activeAdapter`→`provider`/`activeProvider`; `ack.activeAdapterId`→`ack.activeProviderId` (now consumer-less — Phase 4 moved all menus to `ack.cap.*`, so only the `setContext` remains); `mock-adapter.ts`→`mock-provider.ts`, `adapter.test.ts`→`provider.test.ts`; `vitest.config.ts` include updated to `src/providers/**`. **Kept** the persisted `agentId` field and every id/schema string VALUE (`'claude-code'`/`'codex'`/`'copilot'`/`'codex-config'`/`'claude-json'` — none contain "adapter", so the rename left them untouched). Verify: `grep -rin adapter src` → **0** (incl. `.tsx`); `check-types`/`lint`/**332** tests/compile/package all green (type-check proves reference consistency). Phase 1 already handled the cosmetic copy items.
- **Work:**
  1. **Rename map (one isolated, logic-free commit):** `IPlatformAdapter` → `AgentProvider`; sub-interfaces `I*Adapter` → capability slices (`ToolCapability`, `McpCapability`, `PathCapability`, `InstallCapability`, `LifecycleCapability`); `AdapterRegistry` → `ProviderRegistry`; `ClaudeCodeAdapter`/`CodexAdapter`/`CopilotAdapter` → `*Provider`; dir `src/adapters/` → `src/providers/` and `*.adapter.ts` → `*.provider.ts`; `adapter`/`activeAdapter` vars → `provider`/`activeProvider`; `getActiveAdapter`/`getAllAdapters`/`getAdapter` → `getActiveProvider`/`getAllProviders`/`getProvider`; context key **`ack.activeAdapterId` → `ack.activeProviderId`** (change `setContext` in `extension.ts` *and* every `when`-clause in `package.json` in the same commit); tests + `mock-adapter.ts` → `mock-provider.ts`. **Keep** the persisted `agentId` profile field (renaming it needs a data migration).
  2. **Cosmetic:** "Visit the Marketplace" copy in config-panel `ToolList.tsx` and the `McpSettingsForm.tsx` comment. *(The `marketplace-filters__tab` CSS class is already renamed in Phase 1 — see §1a finding 4.)*
- **Files:** effectively all of `src/**` (mechanical), `package.json` (menus + context key), tests.
- **Verify:** `check-types`/`lint`/`test:unit`/`compile` pass; the diff is rename-only (no logic change); `grep -riE "\badapter|marketplace" src` → 0.

### Phase 6 — Docs, manifest, version, final gate
- **Goal:** Ship-ready 2.0.
- **Work:** Update README/USAGE/CONTRIBUTING; add CHANGELOG 2.0 entry (marketplace removal = breaking); replace screenshots; finalize `package.json`. **Supply-chain (§5a):** add `npm audit` to CI and a `.github/dependabot.yml`; set a dependency-update cooldown.
- **Verify:** full gate incl. `test:integration` + `package`; VSIX installs + activates clean; manual smoke of the four surviving capabilities; CI runs `npm audit` and Dependabot is active.

### 5a. Supply-chain hardening (cross-cutting)

Recent npm worm/postinstall attacks raised a "should we leave npm?" question. **Decision: stay on npm.** A VS Code extension's entry point must be JS/TS on the Node extension host, and the whole toolchain (esbuild, `@vscode/vsce`, webview libs) lives on npmjs — so porting the ecosystem is not viable, and switching package manager does not change the registry/maintainer exposure. Instead, harden *within* npm; it is cheap, proportionate, and folded into the phases above.

**Threat model for ACK (small):** the shipped VSIX is esbuild-`--bundle`d and `node_modules` is `.vscodeignore`'d, so **end users never execute the dependency tree.** Real exposure narrows to (a) a malicious **install script** on a dev/CI machine during install, and (b) a **compromised dependency version bundled into a release.** 2.0 already drops two runtime deps (`marked`, `dompurify`).

**Checklist (and where each lands):**
1. **Disable install scripts** — `npm ci --ignore-scripts` everywhere (kills the postinstall-worm class; highest-value single step). Verify the build still works and allowlist any package that genuinely needs a script. → *Phase 0.*
2. **Reproducible installs** — keep `package-lock.json` committed; use `npm ci` (not bare `npm install`) in CI + releases. → *Phase 0.*
3. **Version cooldown** — do not auto-adopt brand-new releases (pin + review, or a ~7-day cooldown); most compromises are caught within days. → *Phase 6 (Dependabot config).*
4. **CI guardrails** — `npm audit` in CI + `.github/dependabot.yml` (none present today); optionally Socket.dev for maintainer-change / risky-install alerts. → *Phase 6.*
5. **Fewer deps (ongoing)** — marketplace removal already helps; later candidates: drop `write-file-atomic` (hand-rolled `fs.rename` + fsync), reconsider React for the lone config-panel webview. Optional, not gating. → *post-2.0.*

This pass is ~half a day, does not block starting, and is **not** a port.

---

## 6. Risks & behavior changes to confirm

**Dropping (confirm):** one-click registry install + user-repo scanning (`userRepositories`); auto-installing missing tools on profile import / workspace activation (→ report-and-skip); settings `ack.userRepositories` / `ack.registrySources` (existing values become inert; no migration unless requested).

**Risks:**
- Phase 4 is the largest blast radius and is separable — Phases 1–3 + 6 deliver "marketplace gone, all local"; Phase 4 can follow as 2.1.
- Claude Code has no local install today, so Phase 2 is a genuine *new* capability (minimum needed to keep "install from local sources" true for Claude Code).
- Hook import intentionally excluded.
- `marked`/`dompurify` removal assumes no markdown rendering needed in config-panel (trivially reversible).

**Open questions:** none blocking — Decisions 1–5 resolved (see §1). The only remaining ⚠️ are NFR performance targets (estimates, to be measured during Phases 0/6), which are not gating decisions.
