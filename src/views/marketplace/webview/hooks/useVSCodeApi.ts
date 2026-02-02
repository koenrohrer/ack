/**
 * Hook for accessing the VS Code webview API.
 *
 * acquireVsCodeApi() can only be called once per webview session,
 * so we cache it in a module-level variable.
 */

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): unknown;
};

let api: ReturnType<typeof acquireVsCodeApi> | undefined;

function getApi(): ReturnType<typeof acquireVsCodeApi> {
  if (!api) {
    api = acquireVsCodeApi();
  }
  return api;
}

export function useVSCodeApi() {
  const vscodeApi = getApi();

  return {
    postMessage: (message: unknown) => vscodeApi.postMessage(message),
    getState: <T>() => vscodeApi.getState() as T | undefined,
    setState: <T>(state: T) => vscodeApi.setState(state),
  };
}
