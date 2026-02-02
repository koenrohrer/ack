/**
 * Typed message protocol for extension <-> webview communication.
 *
 * Uses discriminated unions on the `type` field for type-safe message handling.
 */

// --- Messages FROM extension TO webview ---

export type ExtensionMessage =
  | { type: 'registryData'; tools: RegistryEntryWithSource[]; loading: false }
  | { type: 'registryLoading'; loading: true }
  | { type: 'registryError'; error: string }
  | { type: 'readmeData'; toolId: string; markdown: string }
  | { type: 'readmeLoading'; toolId: string }
  | { type: 'installedTools'; tools: InstalledToolInfo[] }
  | { type: 'installProgress'; toolId: string; status: 'downloading' | 'configuring' | 'writing' | 'verifying' }
  | { type: 'installComplete'; toolId: string; scope: string }
  | { type: 'installError'; toolId: string; error: string }
  | { type: 'installCancelled'; toolId: string }
  | { type: 'installConfigRequired'; toolId: string; fields: ConfigField[] };

// --- Messages FROM webview TO extension ---

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'requestRegistry'; forceRefresh?: boolean }
  | { type: 'requestReadme'; toolId: string; sourceId: string; readmePath: string }
  | { type: 'requestInstall'; toolId: string; sourceId: string }
  | { type: 'submitConfig'; toolId: string; sourceId: string; values: Record<string, string> }
  | { type: 'retryInstall'; toolId: string; sourceId: string }
  | { type: 'requestUninstall'; toolId: string };

// --- Shared types ---

/**
 * Configuration field definition for tool install prompts.
 * Sent from extension to webview when a tool requires configuration values.
 */
export interface ConfigField {
  key: string;
  label: string;
  required: boolean;
  sensitive: boolean;
  description?: string;
  defaultValue?: string;
}

/**
 * Richer installed tool info supporting scope-aware UI (e.g., "Installed (Global)").
 */
export interface InstalledToolInfo {
  name: string;
  type: string;
  scope: string;
}

/**
 * A registry entry augmented with source info for display in the marketplace.
 * Uses `toolType` instead of `type` to avoid collision with the message discriminant.
 */
export interface RegistryEntryWithSource {
  id: string;
  name: string;
  toolType: 'skill' | 'mcp_server' | 'hook' | 'command';
  description: string;
  author: string;
  version: string;
  tags: string[];
  stars: number;
  installs: number;
  readmePath: string;
  contentPath: string;
  createdAt: string;
  updatedAt: string;
  sourceId: string;
  sourceName: string;
}
