import type { ToolType } from '../../types/enums.js';
import type { NormalizedTool } from '../../types/config.js';

/**
 * Top-level type group node (Skills, MCP Servers, Hooks, Commands).
 *
 * Label includes item count, e.g., "Skills (4)".
 * Always collapsible in the tree view.
 */
export interface GroupNode {
  readonly kind: 'group';
  readonly toolType: ToolType;
  readonly label: string;
  readonly children: TreeNode[];
  readonly parent: undefined;
}

/**
 * Intermediate node under Hooks for event types (PreToolUse, PostToolUse, etc.).
 *
 * Provides a second level of hierarchy so hooks are organized by event.
 */
export interface EventGroupNode {
  readonly kind: 'event-group';
  readonly eventName: string;
  readonly label: string;
  readonly children: ToolNode[];
  readonly parent: GroupNode;
}

/**
 * Individual tool item node.
 *
 * For MCP servers, `children` contains SubToolNode entries showing config details.
 * `isEffective` marks the winning entry when a tool exists at multiple scopes.
 */
export interface ToolNode {
  readonly kind: 'tool';
  readonly tool: NormalizedTool;
  readonly children?: SubToolNode[];
  readonly parent: GroupNode | EventGroupNode;
  readonly isEffective?: boolean;
}

/**
 * MCP server config detail sub-item (command, args, transport type).
 *
 * Always a leaf node -- no children.
 */
export interface SubToolNode {
  readonly kind: 'subtool';
  readonly label: string;
  readonly detail: string;
  readonly parentTool: NormalizedTool;
  readonly parent: ToolNode;
}

/**
 * Discriminated union of all tree node types.
 *
 * The `kind` field enables exhaustive switches in getTreeItem and getChildren.
 * Every node carries a `parent` reference so getParent() works for reveal().
 */
export type TreeNode = GroupNode | EventGroupNode | ToolNode | SubToolNode;
