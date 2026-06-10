# Adapter Consistency Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make adapter-specific prompt installation, tool actions, and scope handling consistent across the marketplace, sidebar, and services.

**Architecture:** Keep adapter decisions behind service/adapter capabilities rather than UI-only conditionals. Preserve Codex's existing user-only custom prompt model, make marketplace reporting use the resolved install scope, and share scope metadata between readers.

**Tech Stack:** TypeScript, VS Code extension APIs, Vitest, ESLint, esbuild

**Working Tree Constraint:** Existing bug-fix edits are uncommitted. Do not commit or revert them while applying this plan.

---

### Task 1: Adapter-Neutral Marketplace Prompt Installation

**Files:**
- Modify: `src/views/marketplace/marketplace.panel.ts`
- Modify: `src/services/install.service.ts`
- Modify: `src/services/repo-scanner.service.ts`
- Modify: `src/services/repo-scanner.types.ts`
- Test: `src/test/unit/install.service.test.ts`
- Test: `src/test/unit/repo-scanner.service.test.ts`

- [ ] **Step 1: Add failing tests for prepared custom-prompt content**

Add tests that call a public `installCustomPromptContent()` method with fetched markdown and assert Codex writes at user scope while Copilot delegates to `installInstruction()` at project scope.

```ts
const result = await service.installCustomPromptContent(manifest, '# Prompt\n');
expect(result.scope).toBe(ConfigScope.User);
expect(mockFileIOService.writeTextFile).toHaveBeenCalled();
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run src/test/unit/install.service.test.ts`

Expected: FAIL because `installCustomPromptContent` is not implemented.

- [ ] **Step 3: Implement the shared content installation path**

Refactor `installCustomPrompt()` to fetch content and delegate to the new public content-writing method. Registry installs continue through `install()`, while repo installs use `repoScanner.fetchRepoFile()` and pass its authenticated result into `installCustomPromptContent()`.

- [ ] **Step 4: Protect replacements and normalize Codex names**

Resolve the actual target scope before checking for an existing prompt, require confirmed overwrite allowance before replacing content, and install `review.prompt.md` from a repository as `review.md` for Codex so its visible command name remains `review`.

- [ ] **Step 5: Report resolved scope**

In `executeInstall()`, use `result.scope` in `installComplete` and the information message so Codex user installs are not displayed as project installs.

- [ ] **Step 6: Make repo prompt entries discoverable**

Recognize `.github/prompts/*.prompt.md` in `RepoScannerService` as `custom_prompt` tools. This is the existing Copilot prompt convention and makes the authenticated repo installation route reachable from marketplace results.

- [ ] **Step 7: Verify focused behavior**

Run: `npx vitest run src/test/unit/install.service.test.ts src/test/unit/repo-scanner.service.test.ts`

Expected: PASS.

### Task 2: Codex Project Prompt Contract

**Files:**
- Modify: `src/extension.ts`
- Modify: `README.md`
- Modify: `USAGE.md`

- [ ] **Step 1: Align initialization with current adapter behavior**

Remove project `.codex/prompts/` scaffolding from `ack.initCodexProject`; Codex currently reads and installs custom prompts only in `~/.codex/prompts/`.

- [ ] **Step 2: Correct user-facing documentation**

Describe Codex project initialization as creating `.codex/config.toml` and `skills/`, while retaining documentation that custom prompt file installation is user-scoped.

- [ ] **Step 3: Verify compilation**

Run: `npm run check-types`

Expected: PASS.

### Task 3: Service-Level Capability Enforcement

**Files:**
- Modify: `src/services/tool-manager.service.ts`
- Test: `src/test/unit/tool-manager.service.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
mockAdapter.toggleableToolTypes = new Set([ToolType.Skill]);
const result = await service.toggleTool(makeMcpTool());
expect(result.success).toBe(false);
expect(mockAdapter.toggleTool).not.toHaveBeenCalled();
```

Add the parallel move test with `movableToolTypes`, plus an allowed-default test when the optional capabilities are undefined.

- [ ] **Step 2: Verify tests fail before implementation**

Run: `npx vitest run src/test/unit/tool-manager.service.test.ts`

Expected: FAIL because `ToolManagerService` currently dispatches unsupported actions.

- [ ] **Step 3: Add minimal guards**

After resolving the active adapter, reject a toggle or move when the declared corresponding capability set does not include `tool.type`. Leave adapters that omit capability declarations unchanged.

- [ ] **Step 4: Verify focused tests pass**

Run: `npx vitest run src/test/unit/tool-manager.service.test.ts`

Expected: PASS.

### Task 4: Shared Applicable Scope Metadata

**Files:**
- Create: `src/services/tool-scope.utils.ts`
- Modify: `src/services/config.service.ts`
- Modify: `src/views/tool-tree/tool-tree.model.ts`
- Test: `src/test/unit/config.service.test.ts`
- Test: `src/test/unit/tool-tree.model.test.ts`

- [ ] **Step 1: Establish baseline coverage**

Run: `npx vitest run src/test/unit/config.service.test.ts src/test/unit/tool-tree.model.test.ts`

Expected: PASS, including project-scoped Copilot custom prompts.

- [ ] **Step 2: Extract the shared mapping**

```ts
export const APPLICABLE_SCOPES: Record<ToolType, readonly ConfigScope[]> = {
  [ToolType.Skill]: [ConfigScope.User, ConfigScope.Project],
  [ToolType.Command]: [ConfigScope.User, ConfigScope.Project],
  [ToolType.Hook]: [ConfigScope.User, ConfigScope.Project, ConfigScope.Local, ConfigScope.Managed],
  [ToolType.McpServer]: [ConfigScope.User, ConfigScope.Project, ConfigScope.Managed],
  [ToolType.CustomPrompt]: [ConfigScope.User, ConfigScope.Project],
};
```

Import that mapping from both consumers and remove their duplicated local declarations.

- [ ] **Step 3: Verify behavior is unchanged**

Run: `npx vitest run src/test/unit/config.service.test.ts src/test/unit/tool-tree.model.test.ts`

Expected: PASS.

### Task 5: Independent Review And Full Verification

**Files:**
- Review all changed files only; make fixes solely for actionable findings.

- [ ] **Step 1: Dispatch verifier agents**

Send one verifier the behavioral requirements and one verifier the full code-quality review brief. Require file/line findings and explicit approval or blockers.

- [ ] **Step 2: Run project verification**

Run:

```bash
npm run check-types
npm run lint
npm run test:unit
npm run compile
```

Expected: typecheck, tests, and compile pass; lint has no new warnings.

### Task 6: Review Remediation For Capabilities And MCP Settings

**Files:**
- Modify: `src/adapters/codex/codex.adapter.ts`
- Modify: `src/views/config-panel/config-panel.messages.ts`
- Modify: `src/views/config-panel/config-panel.panel.ts`
- Modify: `src/views/config-panel/config-panel.mcp-utils.ts`
- Modify: `src/views/config-panel/webview/components/McpSettingsForm.tsx`
- Test: `src/test/unit/adapter.test.ts`
- Test: `src/test/unit/config-panel.mcp-utils.test.ts`

- [ ] **Step 1: Explicitly declare Codex action capabilities**

Add `toggleableToolTypes` and `movableToolTypes` containing `Skill` and `McpServer`, excluding `CustomPrompt`, so profile application and management dispatch do not attempt unsupported prompt mutations.

- [ ] **Step 2: Make MCP status editing capability explicit**

Add `canToggle` to `McpSettingsInfo`; populate it as false for Copilot and true for Claude/Codex. Render and submit the enabled checkbox only when status is writable, while leaving environment editing available.

- [ ] **Step 3: Verify focused tests**

Run: `npx vitest run src/test/unit/adapter.test.ts src/test/unit/config-panel.mcp-utils.test.ts`

Expected: PASS.
