/** A single tool listing in the registry index. */
export interface RegistryEntry {
  id: string;
  name: string;
  type: 'skill' | 'mcp_server' | 'hook' | 'command';
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
  /**
   * Which agents this tool supports.
   * Empty array or missing field = all agents (backward compatible).
   */
  agents?: string[];
}

/** The top-level registry index JSON structure. */
export interface RegistryIndex {
  version: number;
  lastUpdated: string;
  tools: RegistryEntry[];
}

/** Configuration for a single registry source. */
export interface RegistrySource {
  id: string;
  name: string;
  owner: string;
  repo: string;
  branch: string;
  indexPath: string;
}

/** Cached data for a single registry source. */
export interface RegistryCache {
  source: RegistrySource;
  index: RegistryIndex;
  etag: string | null;
  fetchedAt: number;
}
