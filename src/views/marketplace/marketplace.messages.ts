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
  | { type: 'readmeData'; toolId: string; html: string }
  | { type: 'readmeLoading'; toolId: string }
  | { type: 'installedTools'; toolIds: string[] };

// --- Messages FROM webview TO extension ---

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'requestRegistry'; forceRefresh?: boolean }
  | { type: 'requestReadme'; toolId: string; sourceId: string; readmePath: string }
  | { type: 'requestInstall'; toolId: string; sourceId: string };

// --- Shared types ---

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
