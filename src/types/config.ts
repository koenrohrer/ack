import { ToolType, ConfigScope, ToolStatus } from './enums.js';

/**
 * Tracks the file origin of a tool definition.
 */
export interface ToolSource {
  filePath: string;
  isDirectory?: boolean;
  directoryPath?: string;
}

/**
 * Tracks where a tool exists across scopes for multi-scope consolidation.
 */
export interface ScopeEntry {
  scope: ConfigScope;
  status: ToolStatus;
  filePath: string;
}

/**
 * The normalized internal representation of a tool.
 * All modules operate on this type -- never raw platform-specific formats.
 */
export interface NormalizedTool {
  id: string;
  type: ToolType;
  name: string;
  description?: string;
  scope: ConfigScope;
  status: ToolStatus;
  statusDetail?: string;
  source: ToolSource;
  metadata: Record<string, unknown>;
  scopeEntries?: ScopeEntry[];
}

/**
 * Result of reading a config file. Encodes success/failure without throwing.
 */
export type ConfigReadResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; filePath: string };

/**
 * Options for writing config files.
 */
export interface ConfigWriteOptions {
  skipBackup?: boolean;
  createIfMissing?: boolean;
}
