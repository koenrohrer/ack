/**
 * Typed message protocol for config panel extension <-> webview communication.
 *
 * Uses discriminated unions on the `type` field for type-safe message handling.
 * Declares ALL messages needed by plans 07-01, 07-02, and 07-03 upfront.
 */

// ---------------------------------------------------------------------------
// Shared interfaces
// ---------------------------------------------------------------------------

/** Profile summary sent to the webview for display. */
export interface ProfileInfo {
  id: string;
  name: string;
  toolCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Tool summary sent to the webview for display. */
export interface ToolInfo {
  key: string;
  name: string;
  type: string;
  scope: string;
  status: string;
  isManaged: boolean;
  hasEditableSettings: boolean;
  filePath: string;
}

/** Tool entry within a profile (key + enabled flag + display info). */
export interface ProfileToolInfo {
  key: string;
  enabled: boolean;
  name: string;
  type: string;
}

/** MCP server settings sent to webview for env editing. */
export interface McpSettingsInfo {
  command: string;
  args: string[];
  env: Record<string, string>;
  transport?: string;
  url?: string;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Messages FROM extension TO webview
// ---------------------------------------------------------------------------

export type ConfigPanelExtMessage =
  | { type: 'profilesData'; profiles: ProfileInfo[]; activeId: string | null }
  | { type: 'toolsData'; tools: ToolInfo[] }
  | { type: 'profileToolsData'; profileId: string; tools: ProfileToolInfo[] }
  | { type: 'mcpSettings'; toolKey: string; settings: McpSettingsInfo }
  | { type: 'operationSuccess'; op: string; message: string }
  | { type: 'operationError'; op: string; error: string }
  | { type: 'profileSwitching'; profileId: string }
  | { type: 'profileSwitchComplete'; result: SwitchResultInfo }
  | { type: 'exportComplete'; profileName: string }
  | { type: 'importComplete'; profileName: string; installed: number; skipped: string[] }
  | { type: 'workspaceAssociation'; profileName: string | null }
  | { type: 'agentChanged'; agentName: string };

/** Switch result shape mirroring SwitchResult from profile.types. */
export interface SwitchResultInfo {
  success: boolean;
  toggled: number;
  skipped: number;
  failed: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Messages FROM webview TO extension
// ---------------------------------------------------------------------------

export type ConfigPanelWebMessage =
  | { type: 'ready' }
  | { type: 'requestProfiles' }
  | { type: 'createProfile'; name: string }
  | { type: 'renameProfile'; id: string; name: string }
  | { type: 'deleteProfile'; id: string }
  | { type: 'switchProfile'; id: string | null }
  | { type: 'requestProfileTools'; id: string }
  | { type: 'updateProfileTools'; id: string; tools: { key: string; enabled: boolean }[] }
  | { type: 'requestTools' }
  | { type: 'requestMcpSettings'; toolKey: string; serverName: string; scope: string }
  | { type: 'updateMcpEnv'; toolKey: string; serverName: string; scope: string; env: Record<string, string>; disabled?: boolean }
  | { type: 'openToolFile'; filePath: string }
  | { type: 'exportProfile'; id: string }
  | { type: 'importProfile' }
  | { type: 'associateProfile'; profileId: string | null };
