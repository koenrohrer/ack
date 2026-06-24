import * as vscode from 'vscode';

/**
 * Scripted stubbing of the interactive vscode.window.* surface.
 *
 * The four UI-input handlers (install, MCP add, profile commands, env vars, the
 * config-panel host) await QuickPick / InputBox / modal dialogs. Rather than add
 * test seams to production handlers, we swap these functions for scripted return
 * values, invoke the real command, and assert the side effects.
 *
 * Each script field is a FIFO queue consumed in call order. A queue entry is
 * either a literal return value or a responder function that receives the call's
 * arguments and returns the value. QuickPick responders MUST return the actual
 * item object(s) from the presented list (handlers read custom fields like
 * `.scope` / `.key` / `.agentId` off the selection).
 */

type QuickPickItems = readonly vscode.QuickPickItem[];
type QuickPickResponder = (
  items: QuickPickItems,
  options: (vscode.QuickPickOptions & { canPickMany?: boolean }) | undefined,
) => vscode.QuickPickItem | readonly vscode.QuickPickItem[] | undefined;
type InputBoxResponder = (options: vscode.InputBoxOptions | undefined) => string | undefined;
type MessageResponder = (message: string, buttons: string[]) => string | undefined;
type OpenDialogResponder = (options: vscode.OpenDialogOptions | undefined) => vscode.Uri[] | undefined;
type SaveDialogResponder = (options: vscode.SaveDialogOptions | undefined) => vscode.Uri | undefined;

export interface InputScript {
  quickPick?: Array<QuickPickResponder | vscode.QuickPickItem | undefined>;
  inputBox?: Array<InputBoxResponder | string | undefined>;
  warning?: Array<MessageResponder | string | undefined>;
  info?: Array<MessageResponder | string | undefined>;
  error?: Array<MessageResponder | string | undefined>;
  openDialog?: Array<OpenDialogResponder | vscode.Uri[] | undefined>;
  saveDialog?: Array<SaveDialogResponder | vscode.Uri | undefined>;
}

export interface CapturedQuickPick {
  items: QuickPickItems;
  options: (vscode.QuickPickOptions & { canPickMany?: boolean }) | undefined;
}

/** Everything observed during a stubbed run, for assertions. */
export interface Captured {
  info: string[];
  warning: string[];
  error: string[];
  quickPicks: CapturedQuickPick[];
  inputBoxes: Array<vscode.InputBoxOptions | undefined>;
  openDialogs: Array<vscode.OpenDialogOptions | undefined>;
  saveDialogs: Array<vscode.SaveDialogOptions | undefined>;
}

/** QuickPick selection helpers. */
export const pick = {
  byLabel:
    (label: string): QuickPickResponder =>
    (items) =>
      items.find((i) => i.label === label),
  byLabelIncludes:
    (sub: string): QuickPickResponder =>
    (items) =>
      items.find((i) => i.label.includes(sub)),
  index:
    (i: number): QuickPickResponder =>
    (items) =>
      items[i],
  where:
    (pred: (item: any) => boolean): QuickPickResponder =>
    (items) =>
      items.find(pred),
  /** canPickMany: return all items whose label is in `labels`. */
  manyByLabels:
    (labels: string[]): QuickPickResponder =>
    (items) =>
      items.filter((i) => labels.includes(i.label)),
  manyWhere:
    (pred: (item: any) => boolean): QuickPickResponder =>
    (items) =>
      items.filter(pred),
  /** canPickMany: select nothing (empty preset). */
  manyNone: (): QuickPickResponder => () => [],
  /** Cancel / Esc. */
  cancel: (): QuickPickResponder => () => undefined,
};

function resolveMessageButtons(rest: unknown[]): string[] {
  // showWarningMessage(message, options?, ...items) | (message, ...items)
  return rest.filter((x) => typeof x === 'string') as string[];
}

/**
 * Swap vscode.window.* for the script, run `fn`, then restore. Returns whatever
 * `fn` returns; `fn` receives the capture object so a test can assert on the
 * notifications and presented items after the command completes.
 */
export async function withStubbedInput<T>(
  script: InputScript,
  fn: (captured: Captured) => Promise<T>,
): Promise<T> {
  const captured: Captured = {
    info: [],
    warning: [],
    error: [],
    quickPicks: [],
    inputBoxes: [],
    openDialogs: [],
    saveDialogs: [],
  };

  const w = vscode.window as any;
  const original = {
    showQuickPick: w.showQuickPick,
    showInputBox: w.showInputBox,
    showWarningMessage: w.showWarningMessage,
    showInformationMessage: w.showInformationMessage,
    showErrorMessage: w.showErrorMessage,
    showOpenDialog: w.showOpenDialog,
    showSaveDialog: w.showSaveDialog,
  };

  const queues = {
    quickPick: [...(script.quickPick ?? [])],
    inputBox: [...(script.inputBox ?? [])],
    warning: [...(script.warning ?? [])],
    info: [...(script.info ?? [])],
    error: [...(script.error ?? [])],
    openDialog: [...(script.openDialog ?? [])],
    saveDialog: [...(script.saveDialog ?? [])],
  };

  w.showQuickPick = async (items: any, options: any) => {
    const resolved: QuickPickItems = await items;
    captured.quickPicks.push({ items: resolved, options });
    if (queues.quickPick.length === 0) {
      throw new Error(
        `Unexpected showQuickPick (title=${options?.title ?? ''}, placeHolder=${options?.placeHolder ?? ''})`,
      );
    }
    const r = queues.quickPick.shift();
    return typeof r === 'function' ? (r as QuickPickResponder)(resolved, options) : r;
  };

  w.showInputBox = async (options: any) => {
    captured.inputBoxes.push(options);
    if (queues.inputBox.length === 0) {
      throw new Error(`Unexpected showInputBox (prompt=${options?.prompt ?? ''})`);
    }
    const r = queues.inputBox.shift();
    return typeof r === 'function' ? (r as InputBoxResponder)(options) : r;
  };

  const makeMessage = (bucket: 'warning' | 'info' | 'error', queue: any[]) =>
    async (message: string, ...rest: unknown[]) => {
      captured[bucket].push(message);
      const buttons = resolveMessageButtons(rest);
      if (queue.length === 0) {
        return undefined; // unscripted notification -> dismissed
      }
      const r = queue.shift();
      return typeof r === 'function' ? (r as MessageResponder)(message, buttons) : r;
    };

  w.showWarningMessage = makeMessage('warning', queues.warning);
  w.showInformationMessage = makeMessage('info', queues.info);
  w.showErrorMessage = makeMessage('error', queues.error);

  w.showOpenDialog = async (options: any) => {
    captured.openDialogs.push(options);
    if (queues.openDialog.length === 0) {
      throw new Error('Unexpected showOpenDialog');
    }
    const r = queues.openDialog.shift();
    return typeof r === 'function' ? (r as OpenDialogResponder)(options) : r;
  };

  w.showSaveDialog = async (options: any) => {
    captured.saveDialogs.push(options);
    if (queues.saveDialog.length === 0) {
      throw new Error('Unexpected showSaveDialog');
    }
    const r = queues.saveDialog.shift();
    return typeof r === 'function' ? (r as SaveDialogResponder)(options) : r;
  };

  try {
    return await fn(captured);
  } finally {
    Object.assign(w, original);
  }
}
