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
  | { type: 'installConfigRequired'; toolId: string; fields: ConfigField[] }
  | { type: 'repoTools'; tools: RegistryEntryWithSource[] }
  | { type: 'repoScanLoading'; repoUrl: string }
  | { type: 'repoScanComplete'; repoUrl: string }
  | { type: 'repoScanError'; repoUrl: string; error: string }
  | { type: 'repoRemoved'; repoUrl: string }
  | { type: 'savedRepos'; repos: SavedRepoInfo[] }
  | { type: 'setTypeFilter'; filter: string }
  | { type: 'agentChanged'; agentName: string };

// --- Messages FROM webview TO extension ---

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'requestRegistry'; forceRefresh?: boolean }
  | { type: 'requestReadme'; toolId: string; sourceId: string; readmePath: string }
  | { type: 'requestInstall'; toolId: string; sourceId: string }
  | { type: 'submitConfig'; toolId: string; sourceId: string; values: Record<string, string> }
  | { type: 'retryInstall'; toolId: string; sourceId: string }
  | { type: 'requestUninstall'; toolId: string }
  | { type: 'addRepo'; url: string }
  | { type: 'removeRepo'; url: string }
  | { type: 'refreshRepo'; url: string }
  | { type: 'openExternal'; url: string };

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

/** Info about a saved repo for the webview repo list. */
export interface SavedRepoInfo {
  url: string;
  repoFullName: string;
  toolCount: number;
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

  source?: 'registry' | 'repo';
  repoUrl?: string;
  repoFullName?: string;
  defaultBranch?: string;
  repoPath?: string;
  repoFiles?: string[];
  relevanceScore?: number;
}
