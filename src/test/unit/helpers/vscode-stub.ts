/**
 * Empty stand-in for the `vscode` module under Vitest.
 *
 * Most providers reach the VS Code API through `import type * as vscode` plus a
 * lazy `await import('vscode')`, so they load fine in the unit suite. Copilot is
 * the exception -- `copilot.provider.ts:1` is a *value* import, which makes the
 * whole module unresolvable outside the extension host and is why there was no
 * `CopilotProvider` unit test before.
 *
 * `CopilotProvider.installSkill` never touches the namespace (it only uses
 * `CopilotPaths` and `FileIOService`), so an empty module is enough to import
 * the class and exercise that method. Anything that actually calls into the
 * VS Code API will fail loudly rather than silently no-op -- that is deliberate;
 * grow this stub only for the surface a test genuinely needs.
 *
 * Wired up via `resolve.alias` in `vitest.config.ts`.
 *
 * ---
 *
 * The `window` / `workspace` members below are exactly the surface
 * `runInstallPlugin` (`tool-tree.plugin-install.ts`) reaches for, and nothing
 * more. They are deliberately inert defaults: a test that cares about one of
 * them replaces the property with its own spy (they are plain object
 * properties, so `vscode.window.showQuickPick` picks the replacement up at call
 * time), and a test that does not care gets a no-op instead of a crash. Any
 * namespace member NOT listed here still fails loudly, per the paragraph above.
 */

/** The only field production code reads off a `showOpenDialog` result. */
export interface StubUri {
  fsPath: string;
}

export const window = {
  showOpenDialog: async (_options?: unknown): Promise<StubUri[] | undefined> => undefined,
  showQuickPick: async (_items?: unknown, _options?: unknown): Promise<unknown> => undefined,
  showInformationMessage: async (..._args: unknown[]): Promise<unknown> => undefined,
  showWarningMessage: async (..._args: unknown[]): Promise<unknown> => undefined,
  showErrorMessage: async (..._args: unknown[]): Promise<unknown> => undefined,
};

/** `workspaceFolders` is `undefined` when no folder is open -- the case §A5 turns on. */
export const workspace: { workspaceFolders: unknown[] | undefined } = {
  workspaceFolders: undefined,
};
