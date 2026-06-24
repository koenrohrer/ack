# ACK 2.0 — Integration Test Coverage

This maps the manual test plan ([`ack-2.0-manual-test-plan.md`](./ack-2.0-manual-test-plan.md),
TC-1..TC-65 + B-1..B-6) to the automated integration suite, and lists what
remains manual and why.

The integration suite runs the **real extension inside a headless VS Code** via
`@vscode/test-electron` (Mocha host, separate from the vitest unit suite). It
drives commands through `vscode.commands.executeCommand`, stubs `vscode.window.*`
to script interactive input, and asserts ACK's **writes on disk** (correct
JSON / TOML / YAML per provider) plus the notifications it raises.

## Running

```bash
npm run test:integration          # macOS/Windows, or any host with a display
xvfb-run -a npm run test:integration   # Linux/headless (CI)
npm test                          # full local gate: check-types + lint + unit + compile + integration
```

`pretest:integration` builds `dist/` (esbuild) and compiles the integration TS to
`out/test/integration/` (CommonJS, via `src/test/integration/tsconfig.json`). The
host is hermetic: each test points `$HOME` / `$HERMES_HOME` at a fresh temp dir
(provider path getters resolve `os.homedir()` / `$HERMES_HOME` live), seeds the
providers it needs on disk, and tears the temp home down afterwards. The real
`$HOME` is never touched. Project scope binds to a temp launch workspace whose
tool dirs are cleaned between tests.

- **Suite size:** 71 integration tests across 8 files (`src/test/integration/*.test.ts`).
- **CI gate:** `.github/workflows/ci.yml` runs the suite under `xvfb-run` as a
  **blocking** step (the former non-blocking probe + "record gap" fallback are gone).

## TC → test mapping

| TC | Area | Status | Integration test (file → name) |
|----|------|--------|--------------------------------|
| TC-1 | Build + activation smoke | ✅ Automated | `activation` → TC-1 |
| TC-2 | `ACK: Open Marketplace` removed | ✅ Automated | `activation` → TC-2 |
| TC-3 | No marketplace UI anywhere | ◑ Partial | Covered by TC-2 (command gone) + no marketplace view/command in `package.json` contributes; full visual sweep stays manual |
| TC-4 | Removed settings absent | ✅ Automated | `activation` → TC-4 / TC-6 |
| TC-5 | No network traffic | ✅ By construction | The whole suite runs offline with no agent CLI installed; no flow performs a fetch |
| TC-6 | Exactly the three ACK settings | ✅ Automated | `activation` → TC-4 / TC-6 |
| TC-7 | Bare `~/.codex` not detected | ✅ Automated | `activation` → TC-7 |
| TC-8 | `config.toml` → detected | ✅ Automated | `activation` → TC-8 |
| TC-9 | `prompts/` → detected + create-config prompt | ✅ Automated | `activation` → TC-9 |
| TC-10 | `skills/` → detected | ✅ Automated | `activation` → TC-10 |
| TC-11 | Markers removed → not detected | ✅ Automated | `activation` → TC-11 |
| TC-12 | Single agent → auto-activate | ✅ Automated | `activation` → TC-12 |
| TC-13 | Last-used wins on relaunch | ✅ Automated | `activation` → TC-13 (re-detect simulates relaunch reconcile) |
| TC-14 | Two detected + no history → chooser | ✅ Automated | `activation` → TC-14 / TC-18 |
| TC-15 | Persisted disappears → other activates | ✅ Automated | `activation` → TC-15 |
| TC-16 | `Re-detect` re-runs reconcile + config checks | ✅ Automated | `activation` → TC-16 (+ TC-9 for the config prompt) |
| TC-17 | No-agents state | ✅ Automated | `activation` → TC-17 |
| TC-18 | Chooser shows only detected (no Copilot) | ✅ Automated | `activation` → TC-14 / TC-18 |
| TC-19 | Clicking a chooser button activates | ✅ Automated | `activation` → TC-19 |
| TC-20 | No-tools state | ◑ Partial | `activation` → TC-20 asserts a single agent auto-activates with empty dirs and no error; the welcome-view text is `ack.noTools`-context/DOM-driven (not readable from a test) |
| TC-21 | Welcome mutual exclusivity | ◔ Manual | The three states are context-key/DOM-driven; the *transitions* are exercised across TC-14/17/19, but "exactly one welcome visible" requires DOM inspection |
| TC-22 | Install skill (User) | ✅ Automated | `install` → TC-22 |
| TC-23 | Install skill (Project) | ✅ Automated | `install` → TC-23 |
| TC-24 | Subfolders reported | ✅ Automated | `install` → TC-24 |
| TC-25 | Empty folder rejected | ✅ Automated | `install` → TC-25 |
| TC-26 | Overwrite confirmation | ✅ Automated | `install` → TC-26 |
| TC-27 | Cancel mid-flow no-op | ✅ Automated | `install` → TC-27 |
| TC-28 | Scope picker depends on workspace | ◑ Partial | `install` → TC-28 covers the with-workspace path (both scopes offered); the no-workspace branch isn't exercised (the launch workspace can't be closed mid-session) |
| TC-29 | Install single-file command | ✅ Automated | `install` → TC-29 |
| TC-30 | Install multi-file command | ✅ Automated | `install` → TC-30 |
| TC-31 | Overwrite conflict naming | ✅ Automated | `install` → TC-31 |
| TC-32 | Cancel single/folder pick | ✅ Automated | `install` → TC-32 |
| TC-33 | Add stdio MCP (Claude, JSON) | ✅ Automated | `mcp` → TC-33 |
| TC-34 | Add HTTP MCP | ✅ Automated | `mcp` → TC-34 (Claude). HTTP server writes `{ url }` to `~/.claude.json` (see Fixes) |
| TC-35 | Server-name validation | ✅ Automated | `mcp` → TC-35 |
| TC-36 | stdio not-on-PATH warn/continue | ✅ Automated | `mcp` → TC-36 |
| TC-37 | Add MCP at Project scope | ✅ Automated | `mcp` → TC-37 |
| TC-38 | Cancel at any step | ✅ Automated | `mcp` → TC-38 |
| TC-39 | No custom-prompt install (Claude) | ✅ Automated | `capability-gating` → TC-39 |
| TC-40 | No env-var menu (Claude) | ✅ Automated | `capability-gating` → TC-40 |
| TC-41 | No per-tool MCP toggle (Claude) | ✅ Automated | `capability-gating` → TC-41 |
| TC-42 | Toggle skill via `SKILL.md` rename | ✅ Automated | `inline-actions` → TC-42 |
| TC-43 | Re-enable legacy dir-disabled skill | ✅ Automated | `inline-actions` → TC-43 |
| TC-44 | Toggle a command | ✅ Automated | `inline-actions` → TC-44 |
| TC-45 | Toggle MCP server (`disabled:true`) | ✅ Automated | `mcp` → TC-45 (+ Codex/Hermes/Pi disable matrix) |
| TC-46 | Move tool between scopes (+conflict) | ✅ Automated | `inline-actions` → TC-46 |
| TC-47 | Delete + "Don't Ask Again" | ✅ Automated | `inline-actions` → TC-47 |
| TC-48 | Open tool source | ✅ Automated | `inline-actions` → TC-48 |
| TC-49 | Refresh tree | ✅ Automated | `inline-actions` → TC-49 |
| TC-50 | Adapter→provider rename invisible | ✅ Automated | `activation` → TC-50 |
| TC-51 | 1.x profile migration | ◑ Partial | `profiles` → TC-51 / TC-52 asserts new profiles are agent-scoped (carry `agentId`); seeding a legacy v1 globalState store to exercise the one-shot migration log isn't done (no globalState seam) |
| TC-52 | Profiles scoped per agent | ✅ Automated | `profiles` → TC-51 / TC-52 |
| TC-53 | Create-by-selection (grouped, blank slate) | ✅ Automated | `profiles` → TC-53 (+ saveAs variant) |
| TC-53a | Complete-preset / blank / cancel / empty | ✅ Automated | `profiles` → TC-53a |
| TC-54 | Switch applies state | ◑ Partial | `profiles` → TC-54 asserts the preset re-applies after manual changes; the "N not found" missing-tool report isn't separately asserted |
| TC-55 | Edit (rename) + delete | ✅ Automated | `profiles` → TC-55 |
| TC-55a | Edit Tools re-sync (pre-check + added tool + Custom Prompts) | ✅ Automated | `profiles` → TC-55a (pre-check/added tool on Claude) + TC-55a Custom Prompts (Pi) |
| TC-56 | Export profile | ✅ Automated | `profiles` → TC-56 |
| TC-57 | Import (round-trip + convert) | ✅ Automated | `profiles` → TC-57 |
| TC-58 | Associate + auto-activate | ✅ Automated | `profiles` → TC-58 |
| TC-59 | Disable workspace auto-activation | ✅ Automated | `profiles` → TC-59 |
| TC-60 | Clone profile to another agent | ◔ Manual | See B-6 (needs a real second agent to verify the cloned result is usable) |
| TC-61 | Open config panel | ✅ Automated | `config-panel` → TC-61 (message protocol; no DOM) |
| TC-62 | Edit + save a setting persists | ✅ Automated | `config-panel` → TC-62 (`updateMcpEnv` → on-disk + `operationSuccess`) |
| TC-63 | Profiles inside the panel | ✅ Automated | `config-panel` → TC-63 |
| TC-64 | External edit refreshes + notifies | ✅ Automated (CI) | `file-watcher` → TC-64 — see File-watcher capability note |
| TC-65 | Notifications can be silenced | ✅ Automated (CI) | `file-watcher` → TC-65 — see File-watcher capability note |

### Provider WRITE matrix (covers the WRITE half of B-1/B-2)

The MCP suite asserts the correct on-disk format and disable mechanism per
provider — the part that does **not** need a real agent CLI:

| Provider | File / format | Add | Disable mechanism | Env vars |
|----------|---------------|-----|-------------------|----------|
| Claude Code | `~/.claude.json` (JSON, `mcpServers`) | ✅ TC-33 | `disabled: true` ✅ TC-45 | n/a (gated, TC-40) |
| Codex | `~/.codex/config.toml` (TOML, `[mcp_servers]`) | ✅ B-1 write | `enabled: false` ✅ | ✅ B-2 write (`[mcp_servers.NAME.env]`) |
| Pi | `~/.pi/agent/mcp.json` (JSON, `mcpServers`) | ✅ | none (asserted absent) ✅ | n/a |
| Hermes | `~/.hermes/config.yaml` (YAML, `mcp_servers`) | ✅ | `enabled: false` ✅ | ✅ (`mcp_servers.NAME.env`) |

## Left manual (out of the blocking gate)

| Item | Reason |
|------|--------|
| **B-1** Codex MCP **ingestion** | The TOML *write* is automated; verifying a real Codex binary actually consumes `config.toml` needs Codex installed (out of scope — host layer only). |
| **B-2** Codex env-var **ingestion** | The TOML env *write* is automated; real Codex ingestion needs Codex. |
| **B-3** Codex custom-prompt install (`~/.codex/prompts/*.md`) | Not yet automated. Driveable with Codex active (the command + overwrite flow), but Codex's `installCustomPromptFile` write path was left out of this pass; verifying Codex *uses* the prompt needs Codex. |
| **B-4** Codex has no commands (`ProviderScopeError`) | Capability is only meaningfully observable with Codex active; covered indirectly by the Claude negatives (TC-39..41) and the provider unit tests. |
| **B-5** Copilot detection + instruction/prompt routing | Copilot detection is gated on `vscode.extensions.getExtension('GitHub.copilot')`, which is **not** installed in the headless host (we launch with `--disable-extensions`). TC-18 covers that Copilot is hidden while undetected; its write ops are Phase 21+ and unimplemented. |
| **B-6 / TC-60** Clone profile to another agent | Cloning filters to compatible tools for a *target* agent; verifying the cloned result is usable there needs a real second agent. |
| **TC-21** Welcome mutual exclusivity | Welcome states are `when`-clause/DOM-driven; context keys aren't readable from a test. Transitions are exercised; "exactly one visible" is a visual check. |
| **TC-20 / TC-3** welcome/marketplace **rendering** | The observable behaviors are automated; the remaining bits are pure view rendering (no DOM automation, per scope). |

## Fixes made while automating

- **Claude HTTP/SSE MCP servers (`McpServerSchema`).** The Add-MCP-Server UI
  offers an HTTP transport that produces `{ url }`, but Claude Code's
  `McpServerSchema` made `command` **required**, so `writeConfigFile` threw on
  add and — worse — *reading* any `~/.claude.json` / `.mcp.json` containing a
  url-only server failed validation and turned the whole file into a single
  error tool. Fixed by making `command` optional and adding a `.refine()` that
  requires a `command` (stdio) **or** a `url` (http/sse) — a server with neither
  is still rejected (the existing schema unit tests still pass). TC-34 now
  asserts the HTTP add on Claude directly; a unit test
  (`schema.service.test.ts` → "accepts an HTTP/SSE MCP server defined by url
  only") locks in the behavior.

## File-watcher capability note (TC-64 / TC-65)

`file-watcher.test.ts` requires working OS file watching. It first probes by
creating a real `FileSystemWatcher` over the workspace and writing a file; if no
event fires within a few seconds it `this.skip()`s TC-64/TC-65 with a logged
reason. On a dev box whose **inotify instance limit** (`fs.inotify.max_user_instances`)
is exhausted by other processes, the watcher cannot register and the two tests
report as *pending* locally; clean CI runners have headroom and exercise them for
real (the write to `{ws}/.mcp.json` — a project-scope watched path inside the
workspace — fires the watcher, the tree refreshes, and the `ACK: Config updated`
toast respects `ack.showChangeNotifications`).
