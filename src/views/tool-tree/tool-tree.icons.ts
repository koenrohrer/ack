import * as vscode from 'vscode';
import { ToolType, ToolStatus, ConfigScope } from '../../types/enums.js';

/**
 * Maps ToolType enum values to their SVG filenames.
 */
const GROUP_SVG_FILES: Record<ToolType, string> = {
  [ToolType.Skill]: 'skills.svg',
  [ToolType.McpServer]: 'mcp-servers.svg',
  [ToolType.Hook]: 'hooks.svg',
  [ToolType.Command]: 'commands.svg',
};

/**
 * Maps ConfigScope to the icon scope label used in composite SVG filenames.
 *
 * User/Managed -> "global" (globe shape)
 * Project/Local -> "project" (folder shape)
 */
function scopeToIconLabel(scope: ConfigScope): string {
  switch (scope) {
    case ConfigScope.User:
    case ConfigScope.Managed:
      return 'global';
    case ConfigScope.Project:
    case ConfigScope.Local:
      return 'project';
  }
}

/**
 * Returns themed SVG icon paths for a top-level group node.
 *
 * Points to `media/icons/light/{type}.svg` and `media/icons/dark/{type}.svg`.
 */
export function getGroupIcon(
  toolType: ToolType,
  extensionUri: vscode.Uri,
): { light: vscode.Uri; dark: vscode.Uri } {
  const filename = GROUP_SVG_FILES[toolType];
  return {
    light: vscode.Uri.joinPath(extensionUri, 'media', 'icons', 'light', filename),
    dark: vscode.Uri.joinPath(extensionUri, 'media', 'icons', 'dark', filename),
  };
}

/**
 * Returns themed composite SVG icon paths for a tool node.
 *
 * The composite icon visually communicates both:
 * - **Scope** via shape: globe outline for global, folder outline for project
 * - **Status** via colored dot: green (enabled), gray (disabled), red (error), amber (warning)
 *
 * Filename format: `tool-{status}-{scopeIcon}.svg`
 * Example: `tool-enabled-global.svg` = globe outline with green dot
 */
export function getToolIcon(
  status: ToolStatus,
  scope: ConfigScope,
  extensionUri: vscode.Uri,
): { light: vscode.Uri; dark: vscode.Uri } {
  const scopeLabel = scopeToIconLabel(scope);
  const filename = `tool-${status}-${scopeLabel}.svg`;
  return {
    light: vscode.Uri.joinPath(extensionUri, 'media', 'icons', 'light', filename),
    dark: vscode.Uri.joinPath(extensionUri, 'media', 'icons', 'dark', filename),
  };
}
