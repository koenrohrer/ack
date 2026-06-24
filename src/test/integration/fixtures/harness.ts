import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { parse as parseToml } from 'smol-toml';
import { load as parseYaml } from 'js-yaml';
import { withStubbedInput, InputScript, Captured } from './input';

export const EXT_ID = 'koenrohrer.ack';

/** Provider ids, as registered in extension.ts. */
export const AgentId = {
  claudeCode: 'claude-code',
  codex: 'codex',
  copilot: 'copilot',
  pi: 'pi',
  hermes: 'hermes',
} as const;

/** Tool-type discriminators (string enums in the SUT). */
export const ToolType = {
  skill: 'skill',
  mcpServer: 'mcp_server',
  hook: 'hook',
  command: 'command',
  customPrompt: 'custom_prompt',
} as const;

export const Scope = {
  user: 'user',
  project: 'project',
  local: 'local',
  managed: 'managed',
} as const;

// ---------------------------------------------------------------------------
// Activation + command driving
// ---------------------------------------------------------------------------

/** Ensure the extension is activated (it activates on startup; this is idempotent). */
export async function activateExtension(): Promise<vscode.Extension<unknown>> {
  const ext = vscode.extensions.getExtension(EXT_ID);
  if (!ext) {
    throw new Error(`Extension ${EXT_ID} not found in the test host`);
  }
  if (!ext.isActive) {
    await ext.activate();
  }
  return ext;
}

export function run(command: string, ...args: unknown[]): Thenable<unknown> {
  return vscode.commands.executeCommand(command, ...args);
}

/** Let fire-and-forget onDidSwitchAgent listeners drain before observing state. */
export function settle(ms = 60): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Set the active + persisted agent directly (no quickpick), via ack.activateAgent. */
export async function activateAgent(id: string): Promise<void> {
  await run('ack.activateAgent', id);
  await settle();
}

/**
 * Re-run detection + reconcile (mirrors a relaunch's startup reconcile).
 *
 * Always runs under an input stub: redetect awaits each provider's
 * checkConfiguration(), and Codex's shows an action notification when detected
 * without a config.toml -- left unstubbed it would never resolve in headless and
 * hang the call. Unscripted info/warning auto-dismiss; pass a `script` to assert
 * on (or answer) the surfaced prompts.
 */
export async function redetect(script: InputScript = {}): Promise<Captured> {
  const cap = await withStubbedInput(script, async (c) => {
    await run('ack.redetectAgents');
    return c;
  });
  await settle();
  return cap;
}

/**
 * Read-only probe of detection + active state. Opens the Switch Agent quickpick
 * (whose items carry `(active)` / `detected` / `not detected` descriptions and an
 * `agentId`), captures the items, then cancels. Undetected hideWhenUndetected
 * providers (Copilot) are omitted from the list entirely.
 */
export interface AgentProbe {
  /** agentId -> one of 'active' | 'detected' | 'not detected'. */
  state: Record<string, string>;
  /** ids present in the quickpick (in order). */
  ids: string[];
  activeId: string | undefined;
}

export async function probeAgents(): Promise<AgentProbe> {
  return withStubbedInput({ quickPick: [() => undefined] }, async (cap) => {
    await run('ack.switchAgent');
    const items = (cap.quickPicks[0]?.items ?? []) as Array<vscode.QuickPickItem & { agentId?: string }>;
    const state: Record<string, string> = {};
    const ids: string[] = [];
    let activeId: string | undefined;
    for (const item of items) {
      if (!item.agentId) continue;
      ids.push(item.agentId);
      const desc = item.description ?? '';
      state[item.agentId] = desc.replace(/[()]/g, '');
      if (desc.includes('active')) activeId = item.agentId;
    }
    return { state, ids, activeId };
  });
}

/**
 * Poll probeAgents() until `pred` holds (or the timeout elapses), returning the
 * final probe. Absorbs the brief async settling of fire-and-forget switch
 * listeners so reconcile assertions are not flaky.
 */
export async function probeUntil(
  pred: (probe: AgentProbe) => boolean,
  timeoutMs = 5000,
): Promise<AgentProbe> {
  let probe = await probeAgents();
  const start = Date.now();
  while (!pred(probe) && Date.now() - start < timeoutMs) {
    await settle(80);
    probe = await probeAgents();
  }
  return probe;
}

/** True if the agent shows as detected (or active, since auto-activate persists it). */
export function agentDetected(probe: AgentProbe, id: string): boolean {
  return probe.state[id] === 'detected' || probe.state[id] === 'active';
}

/** True if the agent is listed but not detected (hidden providers count as not detected). */
export function agentNotDetected(probe: AgentProbe, id: string): boolean {
  return !(id in probe.state) || probe.state[id] === 'not detected';
}

// ---------------------------------------------------------------------------
// Config file paths (independent of the SUT path modules, so tests assert the
// paths ACK is expected to write rather than importing its own logic).
// ---------------------------------------------------------------------------

export const cfgPath = {
  claude: {
    userMcp: (home: string) => path.join(home, '.claude.json'),
    projectMcp: (ws: string) => path.join(ws, '.mcp.json'),
    userSkillsDir: (home: string) => path.join(home, '.claude', 'skills'),
    projectSkillsDir: (ws: string) => path.join(ws, '.claude', 'skills'),
    userCommandsDir: (home: string) => path.join(home, '.claude', 'commands'),
    userSettings: (home: string) => path.join(home, '.claude', 'settings.json'),
  },
  codex: {
    userConfig: (home: string) => path.join(home, '.codex', 'config.toml'),
    projectConfig: (ws: string) => path.join(ws, '.codex', 'config.toml'),
    userSkillsDir: (home: string) => path.join(home, '.codex', 'skills'),
    userPromptsDir: (home: string) => path.join(home, '.codex', 'prompts'),
  },
  pi: {
    userMcp: (home: string) => path.join(home, '.pi', 'agent', 'mcp.json'),
    projectMcp: (ws: string) => path.join(ws, '.pi', 'mcp.json'),
    userSkillsDir: (home: string) => path.join(home, '.pi', 'agent', 'skills'),
  },
  hermes: {
    config: (hermesHome: string) => path.join(hermesHome, 'config.yaml'),
    skillsDir: (hermesHome: string) => path.join(hermesHome, 'skills'),
    soul: (hermesHome: string) => path.join(hermesHome, 'SOUL.md'),
  },
  copilot: {
    projectMcp: (ws: string) => path.join(ws, '.vscode', 'mcp.json'),
  },
};

// ---------------------------------------------------------------------------
// Read-back helpers (assert ACK's writes)
// ---------------------------------------------------------------------------

export function exists(p: string): boolean {
  return fs.existsSync(p);
}

export function readText(p: string): string {
  return fs.readFileSync(p, 'utf8');
}

export function readJson(p: string): any {
  return JSON.parse(readText(p));
}

export function readToml(p: string): any {
  return parseToml(readText(p));
}

export function readYaml(p: string): any {
  return parseYaml(readText(p));
}

// ---------------------------------------------------------------------------
// Tree-node builders
//
// The toggle/delete/move/install command handlers receive the tree node that
// was clicked. Tests can't read the tree provider, so we synthesize faithful
// nodes. The managers operate on the carried NormalizedTool directly (string
// enums make plain objects structurally compatible).
// ---------------------------------------------------------------------------

export interface ToolNodeOpts {
  type: string;
  name: string;
  scope?: string;
  status?: string;
  filePath: string;
  isDirectory?: boolean;
  directoryPath?: string;
  metadata?: Record<string, unknown>;
}

export function toolNode(opts: ToolNodeOpts): any {
  return {
    kind: 'tool',
    tool: {
      id: `${opts.type}:${opts.name}`,
      type: opts.type,
      name: opts.name,
      scope: opts.scope ?? Scope.user,
      status: opts.status ?? 'enabled',
      source: {
        filePath: opts.filePath,
        isDirectory: opts.isDirectory ?? false,
        directoryPath: opts.directoryPath,
      },
      metadata: opts.metadata ?? {},
    },
  };
}

/** A skill node. `dir` is the skill directory; `disabledFile`/`disabledDir` pick the on-disk layout. */
export function skillNode(opts: {
  name: string;
  dir: string;
  scope?: string;
  status?: string;
  disabledFile?: boolean;
  disabledDir?: boolean;
}): any {
  const fileName = opts.disabledFile ? 'SKILL.md.disabled' : 'SKILL.md';
  return toolNode({
    type: ToolType.skill,
    name: opts.name,
    scope: opts.scope,
    status: opts.status ?? (opts.disabledFile || opts.disabledDir ? 'disabled' : 'enabled'),
    filePath: path.join(opts.dir, fileName),
    isDirectory: false,
    directoryPath: opts.dir,
  });
}

/** A command node (single file or directory). */
export function commandNode(opts: {
  name: string;
  filePath: string;
  scope?: string;
  status?: string;
  isDirectory?: boolean;
  directoryPath?: string;
}): any {
  return toolNode({
    type: ToolType.command,
    name: opts.name,
    scope: opts.scope,
    status: opts.status,
    filePath: opts.filePath,
    isDirectory: opts.isDirectory ?? false,
    directoryPath: opts.directoryPath,
  });
}

/** An MCP server node. `configPath` is the backing config file. */
export function mcpNode(opts: {
  name: string;
  configPath: string;
  scope?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}): any {
  return toolNode({
    type: ToolType.mcpServer,
    name: opts.name,
    scope: opts.scope,
    status: opts.status,
    filePath: opts.configPath,
    metadata: opts.metadata,
  });
}

/** A custom-prompt node (Codex/Pi prompt file). */
export function customPromptNode(opts: {
  name: string;
  filePath: string;
  scope?: string;
}): any {
  return toolNode({
    type: ToolType.customPrompt,
    name: opts.name,
    scope: opts.scope,
    filePath: opts.filePath,
  });
}

/** A group node (the +-install target for a tool type). */
export function groupNode(toolType: string): any {
  return { kind: 'group', toolType, label: toolType, children: [], parent: undefined };
}

/** An env-var sub-node under an MCP server. */
export function envVarNode(opts: { key: string; value?: string; parentTool: any }): any {
  return {
    kind: 'subtool',
    subKind: 'env-var',
    label: opts.key,
    detail: opts.value ?? '',
    parentTool: opts.parentTool.tool ?? opts.parentTool,
    parent: opts.parentTool,
  };
}

/** Build a Uri[] for showOpenDialog responders. */
export function uris(...paths: string[]): vscode.Uri[] {
  return paths.map((p) => vscode.Uri.file(p));
}

/** Poll until `pred()` is true or the timeout elapses. */
export async function waitFor(
  pred: () => boolean | Promise<boolean>,
  timeoutMs = 8000,
  intervalMs = 100,
): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    if (await pred()) return true;
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
