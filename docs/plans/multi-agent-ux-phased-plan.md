# ACK — Multi-Agent Startup UX + Codex Detection Fix — Phased Plan

**Status:** ✅ All phases implemented & committed on branch `multi-agent-ux` (2026-06-20). Gate green throughout; **349** unit tests (+17). F5 smoke pending (user).
**Date:** 2026-06-20
**Branch:** `multi-agent-ux` off `2.0-core` (do NOT commit to `master`)
**Baseline:** `2.0-core` @ `010a97d`; gate green — check-types/lint/compile/package, **332** unit tests.
**Scope:** Three changes — (1) tighten Codex detection, (2) last-used-first startup activation, (3) a state-aware sidebar welcome view that lets the user pick when several agents are detected.

---

## 0. Orientation (verified against source 2026-06-20)

| Concern | Where it lives today | Note |
|---|---|---|
| Codex detection | `src/providers/codex/codex.provider.ts:233-235` — `detect()` returns `fileExists(CodexPaths.userCodexDir)` | True whenever `~/.codex` merely exists → false-positives on a dir-name collision |
| "no config.toml → create one?" flow | `codex.provider.ts:280-320` (`checkConfiguration`), self-gated by `if (!(await this.detect())) return;` at `:281` | **Depends on `detect()` returning true without `config.toml`** — any new marker must preserve this |
| Codex paths | `src/providers/codex/paths.ts` — `userCodexDir`, `userConfigToml`, `userPromptsDir`, `userSkillsDir` | The marker reads from here only |
| Startup reconcile | `src/extension.ts:301-365` (the IIFE) | Real reconcile logic is **inline here**, not in the registry |
| `ProviderRegistry.detectAndActivate` | `src/providers/provider.registry.ts:62-78` | **Test-only** (`provider.test.ts`) — NOT on the startup path; leave untouched |
| Persist / switch | `src/services/agent-switcher.service.ts` — `getPersistedAgentId()`, `switchAgent(id)` (persists to `globalState['ack.activeAgentId']`) | Reused as-is |
| "multiple detected" today | `extension.ts:334-339` — passive toast "Multiple agents detected. Use the status bar to select one." | **Replaced** by routing to the chooser |
| Switch-side context keys | `extension.ts:197-225` `onDidSwitchAgent` (sets `ack.activeProviderId` + `ack.cap.*`) | Extend to clear `ack.noAgents`/`ack.chooseAgent` on activation |
| `ack.noTools` | set in `src/views/tool-tree/tool-tree.provider.ts:67-71` (`groups.length === 0`); consumed by `package.json:58-64` `viewsWelcome` + `:62` `when` | **Redefined** to "an agent is active AND it has zero tool groups" |
| `hideWhenUndetected` | `types/provider-lifecycle.ts:20`; Copilot sets it (`copilot.provider.ts:43`); consumed in `agent-switcher.quickpick.ts:27` | Preserved by gating each chooser button on per-agent detection |
| Re-detect command | `extension.ts:228-285` (`ack.redetectAgents`) — its own multi-detect toast loop | Brought into line with the new reconcile + keys |

**Testing constraints (carried from 2.0):** there is **no `vscode` mock** in unit tests. Keep vscode-importing code out of unit-tested modules — extract pure logic into a `*.utils.ts` and test that (precedent: `local-install.utils.ts`, `tool-tree.command-utils.ts`). `CodexProvider` is already unit-importable (it loads `vscode` lazily via `await import('vscode')`), so its `detect()` is testable via a fake `FileIOService`.

---

## 1. Decisions (resolved 2026-06-20)

1. **Codex marker = `config.toml` OR `prompts/` OR `skills/` present** (under `~/.codex`). ✅
   *Justification:* these three are Codex-**owned** artifacts (all sourced from `CodexPaths`). The described collision — an unrelated tool owning `~/.codex` with sqlite/memory files — has none of them, so it is correctly rejected. Crucially, a real Codex install that has not written `config.toml` yet (but has `prompts/` or `skills/`) **still detects**, so the "Codex detected but no config.toml → create one?" flow at `checkConfiguration` stays reachable. *(Rejected: `config.toml`-only — it would make that flow dead code, since `detect()` would be false without the file. Rejected: adding `codex`-CLI-on-PATH — PATH scanning + Windows `.exe/.cmd` handling for no gain against the collision case.)*

2. **Welcome states are driven by boolean context keys.** ✅
   - `ack.noAgents` — zero agents detected.
   - `ack.chooseAgent` — ≥2 detected **and** none active.
   - `ack.noTools` — **redefined**: an agent IS active and produced zero tool groups.
   - `ack.agentDetected.<sanitizedId>` — one per known agent, gates the per-agent chooser buttons.

   The first three are mutually exclusive by construction (see §2, Phase 2 truth table), so exactly one welcome renders. Dotted keys match the existing `ack.cap.*` style.

3. **Chooser buttons → one `ack.activateAgent` command taking the agent id via a URI-encoded arg.** ✅
   `[Activate Codex](command:ack.activateAgent?%5B%22codex%22%5D)`. One button per detected agent, each gated `when: ack.chooseAgent && ack.agentDetected.<sanitizedId>`. The command body calls `agentSwitcher.switchAgent(id)` (persists + fires the switch event, which clears the chooser keys). Undetected agents never show a button → `hideWhenUndetected` semantics preserved for Copilot.

4. **Hyphen sanitization for the per-agent key leaf (sub-decision).** ✅
   VS Code `when`-clause parsing of hyphens in key names is not documented/guaranteed (a `-` risks being read as subtraction). So the **context-key leaf strips hyphens**: `claude-code → ack.agentDetected.claudecode`, `codex → ack.agentDetected.codex`, `copilot → ack.agentDetected.copilot`. The **command argument keeps the real id** (`claude-code`) — it is URI-encoded JSON, unrelated to the key name. A single pure helper owns the `id → key` mapping so package.json and runtime never drift.

---

## 2. Phased plan

> **GATE (run after every phase; must stay green):**
> `npm run check-types` · `npm run lint` (one pre-existing unused-`_` warning OK) · `npm run test:unit` (≥332, rising) · `npm run compile` · `npm run package`.
> One conventional-commit per phase. **No AI/assistant attribution** (no `Co-Authored-By`, no "Generated with" footer) per `~/.claude/CLAUDE.md`. Keep `agentId` and all id values (`claude-code`/`codex`/`copilot`) unchanged.
> F5 (Extension Development Host) smoke is **user-run** — remember its two artifacts: its own empty `globalState` (so "last-used" starts blank there), and it inherits installed VS Code extensions (so Copilot detects). Neither is a bug.

---

### Phase 1 — Tighten Codex detection
- **Status:** ✅ Complete (`3e6dbce`). New pure `isCodexInstalled()` + `detect()` rewrite (parallel `fileExists` of config.toml/prompts/skills); 9 new tests. Gate green (341 tests).
- **Goal:** `detect()` rejects a `~/.codex` directory-name collision while still detecting a real install (incl. one with no `config.toml` yet).
- **Work:**
  - New pure module `src/providers/codex/codex.detect.utils.ts` exporting `isCodexInstalled(markers: { configToml: boolean; promptsDir: boolean; skillsDir: boolean }): boolean` → `configToml || promptsDir || skillsDir`. Pure, no vscode, no fs.
  - Rewrite `CodexProvider.detect()` to `fileExists` the three `CodexPaths` targets (`userConfigToml`, `userPromptsDir`, `userSkillsDir`) and delegate to `isCodexInstalled`. Update the method's doc-comment (currently says "Returns true if ~/.codex/ directory exists").
  - Do **not** touch `checkConfiguration` / `getCommands` / `initProject` — Decision 1 keeps them reachable.
- **Files:** `src/providers/codex/codex.detect.utils.ts` (new), `src/providers/codex/codex.provider.ts`, `src/test/unit/codex.detect.utils.test.ts` (new).
- **Tests:** `isCodexInstalled` — true for each marker alone, true for combinations, **false for none** (the collision case). Optionally a `detect()` test with a fake `FileIOService` asserting the three paths probed are exactly the `config.toml`/`prompts`/`skills` paths and that "dir exists but none present" → false.
- **Verify:** GATE green; new tests pass. F5 (user): a `~/.codex` with only unrelated files → Codex **not** detected; a real Codex install → detected; a `~/.codex` with `prompts/`/`skills/` but no `config.toml` → detected **and** the "create config?" prompt still appears.
- **Commit:** `fix(codex): require a Codex-owned marker for detection`

---

### Phase 2 — Last-used-first reconcile + welcome context-key plumbing  *(change A)*
- **Status:** ✅ Complete (`33c7ea9`). Pure `decideStartupAgent()`/`agentDetectedKey()` + 8 tests; shared `applyDetectionResult()` drives startup **and** re-detect; `onDidSwitchAgent` clears `ack.noAgents`/`ack.chooseAgent`; `ack.noTools` redefined to require an active agent. Old multi-detect toasts removed. Gate green (349 tests).
- **Goal:** Startup activates the persisted agent if still detected; else the single detected agent; else (≥2, no usable history) does **not** auto-pick — it routes to the chooser. Replace the passive "multiple detected" toast. Wire the context keys the Phase 3 views consume.
- **Work:**
  - New pure module `src/services/agent-reconcile.utils.ts`:
    - `decideStartupAgent({ persistedId, detectedIds }): { kind: 'activate'; id: string } | { kind: 'choose' } | { kind: 'none' }` — (a) persisted∈detected → `activate(persisted)`; (b) `detectedIds.length === 1` → `activate(only)`; (c) `length ≥ 2` → `choose`; else → `none`.
    - `agentDetectedKey(id: string): string` → `` `ack.agentDetected.${id.replace(/-/g, '')}` `` (Decision 4).
  - `extension.ts` startup IIFE (`:301-365`): build `detectedIds`, call `decideStartupAgent`, then:
    - `activate` → `agentSwitcher.switchAgent(id)` (existing behavior).
    - `choose` → set `ack.chooseAgent = true`; **drop** the `:334-339` info toast.
    - `none` → set `ack.noAgents = true` (keep the existing log; the install message now comes from the welcome view, so drop the redundant `:341-345` info toast).
    - Always: for every `registry.getAllProviders()`, `setContext(agentDetectedKey(p.id), detectedIds.includes(p.id))`; set `ack.noAgents`/`ack.chooseAgent` explicitly each run (false unless that branch sets them).
  - `onDidSwitchAgent` (`:197-225`): when a provider becomes active, also `setContext('ack.chooseAgent', false)` and `setContext('ack.noAgents', false)`.
  - `tool-tree.provider.ts:67-71`: redefine `ack.noTools` to `!!registry.getActiveProvider() && groups.length === 0` (the provider already holds `this.registry`).
  - `ack.redetectAgents` (`:228-285`): replace the bespoke multi-detect toast loop with the same `decideStartupAgent` + key-setting path, so re-detect and startup behave identically (activate / route-to-chooser / warn).
- **Truth table (mutual exclusion — confirm during review):**

  | State | `ack.noAgents` | `ack.chooseAgent` | `ack.noTools` |
  |---|---|---|---|
  | 0 detected | ✅ | — | — (no active agent) |
  | ≥2 detected, none active | — | ✅ | — (no active agent) |
  | 1 active, has tools | — | — | — |
  | 1 active, 0 tools | — | — | ✅ |

- **Files:** `src/services/agent-reconcile.utils.ts` (new), `src/extension.ts`, `src/views/tool-tree/tool-tree.provider.ts`, `src/test/unit/agent-reconcile.utils.test.ts` (new).
- **Tests:** `decideStartupAgent` — persisted-and-detected → activate(persisted); persisted-but-gone + 1 other → activate(other); persisted-but-gone + 2 others → choose; exactly 1 (no persist) → activate; ≥2 (no persist) → choose; 0 → none. `agentDetectedKey('claude-code') === 'ack.agentDetected.claudecode'`.
- **Verify:** GATE green. F5 (user, noting dev-host empty globalState): 1 agent → auto-activates; after switching + reload → restored; with ≥2 detected and no history → nothing auto-activates and **no** "use the status bar" toast (the Phase 3 chooser is the surface).
- **Commit:** `feat(startup): last-used-first activation; route multi-detect to chooser`

---

### Phase 3 — State-aware welcome view + chooser command  *(change C)*
- **Status:** ✅ Complete (`4510e4a`). New `ack.activateAgent` command (id via URI-encoded arg, registry-guarded); `viewsWelcome` split into no-agents / choose-header / per-agent buttons / active-empty. Gate green (349 tests; package.json + thin command are unit-test-exempt — the pure mapping is covered in Phase 2).
- **Goal:** Replace the single misleading welcome with three states; let the user activate a detected agent in one click.
- **Work:**
  - New command `ack.activateAgent` (registered in `extension.ts`): `(agentId: string) => agentSwitcher.switchAgent(agentId)`. Declare it in `package.json` `commands` (no menu entry; invoked only from welcome links).
  - `package.json` `viewsWelcome` — replace the lone entry with:
    - **No agents** (`when: ack.noAgents`): "No agent tools found.\n\nInstall a supported agent to get started.\n[Claude Code](…) | [Codex](…)" (keep the existing links).
    - **Choose — header** (`when: ack.chooseAgent`): "Multiple agents detected — choose one:".
    - **Choose — one button per agent** (`when: ack.chooseAgent && ack.agentDetected.<sanitizedId>`): `[Activate Claude Code](command:ack.activateAgent?%5B%22claude-code%22%5D)`, `…?%5B%22codex%22%5D`, `…?%5B%22copilot%22%5D`. Copilot's button only renders when `ack.agentDetected.copilot` is true → `hideWhenUndetected` preserved.
    - **Active but empty** (`when: ack.noTools`): "No tools configured for the active agent yet.\n\nUse the **+** on a tool group (Skills, Commands, MCP) to install one from a local file or folder."
- **Files:** `package.json` (`commands` + `viewsWelcome`), `src/extension.ts`.
- **Verify:** GATE green (package.json `viewsWelcome`/command are not unit-tested; the pure mapping is covered in Phase 2). F5 (user): with ≥2 detected and none active → "Multiple agents detected — choose one" + a button per **detected** agent (Copilot only if its extension is present); clicking a button activates that agent and the tree populates; uninstall/disable all agents → "install an agent" + links; an active agent with no tools → the local-install hint.
- **Commit:** `feat(welcome): state-aware sidebar (no-agents / choose / empty)`

---

## 3. Cut line & risks
- **Independently shippable:** Phase 1 (detection fix) stands alone. Phases 2+3 are the multi-agent UX and ship together (Phase 2 sets the keys, Phase 3 renders them); between those two commits the multi-detect state shows no welcome — acceptable mid-branch, not a release boundary.
- **`viewsWelcome` command args** are verified-supported (`command:id?<uri-encoded-json>`), but are not exercised by unit tests. If F5 shows a button not firing, the fallback is a single generic `[Choose an agent…](command:ack.switchAgent)` button (reuses the existing quick pick) — no code change beyond package.json.
- **`detectAndActivate` stays as-is** (test-only); not on the startup path. Do not "fix" it — its tests are part of the 332 baseline.
- **`agentId` + all id string values unchanged** (no stored-state migration).
```
