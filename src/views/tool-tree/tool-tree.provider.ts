import * as vscode from 'vscode';
import type { ConfigService } from '../../services/config.service.js';
import type { AdapterRegistry } from '../../adapters/adapter.registry.js';
import { ToolStatus } from '../../types/enums.js';
import { ToolTreeModel } from './tool-tree.model.js';
import { getGroupIcon, getToolIcon } from './tool-tree.icons.js';
import type {
  TreeNode,
  GroupNode,
  EventGroupNode,
  ToolNode,
  SubToolNode,
} from './tool-tree.nodes.js';

/**
 * TreeDataProvider for the agent tool tree sidebar view.
 *
 * Implements the full VS Code TreeDataProvider interface with:
 * - getChildren: returns root groups or child nodes
 * - getTreeItem: transforms tree nodes into VS Code TreeItems
 * - getParent: enables reveal() by walking parent references
 * - refresh: triggers full tree rebuild
 *
 * Does NOT register file watchers or command handlers -- those are
 * wired up in a separate plan (02-03) to keep concerns isolated.
 */
export class ToolTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly model: ToolTreeModel;
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /**
   * The tree view instance, available after register() is called.
   */
  treeView: vscode.TreeView<TreeNode> | undefined;

  /** Tracks the last profile name set via setActiveProfile for re-assertion after refresh. */
  private activeProfileName: string | null | undefined;

  constructor(
    private readonly configService: ConfigService,
    private readonly registry: AdapterRegistry,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.model = new ToolTreeModel();
  }

  // -------------------------------------------------------------------------
  // TreeDataProvider interface
  // -------------------------------------------------------------------------

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      // Root: rebuild and return top-level groups
      await this.model.rebuild(this.configService, this.registry);
      const groups = this.model.getRootGroups();

      // Set context key for welcome view visibility
      await vscode.commands.executeCommand(
        'setContext',
        'agent-config-keeper.noTools',
        groups.length === 0,
      );

      return groups;
    }

    switch (element.kind) {
      case 'group':
        return element.children;
      case 'event-group':
        return element.children;
      case 'tool':
        return element.children ?? [];
      case 'subtool':
        return [];
    }
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    switch (element.kind) {
      case 'group':
        return this.createGroupItem(element);
      case 'event-group':
        return this.createEventGroupItem(element);
      case 'tool':
        return this.createToolItem(element);
      case 'subtool':
        return this.createSubToolItem(element);
    }
  }

  getParent(element: TreeNode): TreeNode | undefined {
    return element.parent;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Trigger a full tree refresh.
   *
   * Fires the change event with undefined to indicate the entire
   * tree should be re-fetched (getChildren called from root).
   */
  async refresh(): Promise<void> {
    this._onDidChangeTreeData.fire(undefined);
    // Re-assert the description after firing the change event.
    // VS Code can reset the description during tree data refresh,
    // so we re-apply whatever was last set.
    if (this.treeView && this.activeProfileName !== undefined) {
      this.treeView.description = this.activeProfileName ?? 'Current Environment';
    }
  }

  /**
   * Update the sidebar header description to show the active profile name.
   *
   * When a profile is active, the header shows its name (e.g., "Full Setup").
   * When no profile is active (null), reverts to the default "Current Environment".
   */
  setActiveProfile(profileName: string | null): void {
    this.activeProfileName = profileName;
    if (!this.treeView) {
      return;
    }
    this.treeView.description = profileName ?? 'Current Environment';
  }

  /**
   * Register the tree view with VS Code.
   *
   * Creates the tree view instance with collapse-all button,
   * sets the description header, and pushes to subscriptions
   * for proper disposal.
   */
  register(context: vscode.ExtensionContext): void {
    this.treeView = vscode.window.createTreeView(
      'agent-config-keeper.toolTree',
      {
        treeDataProvider: this,
        showCollapseAll: true,
      },
    );
    this.treeView.description = 'Current Environment';
    context.subscriptions.push(this.treeView);
  }

  // -------------------------------------------------------------------------
  // TreeItem construction
  // -------------------------------------------------------------------------

  private createGroupItem(node: GroupNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.iconPath = getGroupIcon(node.toolType, this.extensionUri);
    item.contextValue = `group:${node.toolType}`;
    // No command -- clicking expands/collapses only (RESEARCH pitfall #2)
    return item;
  }

  private createEventGroupItem(node: EventGroupNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.iconPath = new vscode.ThemeIcon('symbol-event');
    item.contextValue = 'event-group';
    return item;
  }

  private createToolItem(node: ToolNode): vscode.TreeItem {
    const tool = node.tool;
    const hasChildren = (node.children?.length ?? 0) > 0;

    const item = new vscode.TreeItem(
      tool.name,
      hasChildren
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );

    // Composite SVG icon showing scope shape + status color
    item.iconPath = getToolIcon(tool.status, tool.scope, this.extensionUri);

    // Description: error messages and active indicator only
    // Scope is communicated entirely via the composite icon
    if (tool.status === ToolStatus.Error) {
      item.description = tool.statusDetail ?? 'Error';
    } else if (tool.status === ToolStatus.Disabled) {
      item.description = '(disabled)';
    } else if (node.isEffective) {
      item.description = '(active)';
    }

    // Rich tooltip with full details
    const scopeLabel =
      tool.scope === 'user' || tool.scope === 'managed' ? 'Global' : 'Project';
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`**${tool.name}**\n\n`);
    tooltip.appendMarkdown(`Status: ${tool.status}\n\n`);
    tooltip.appendMarkdown(`Scope: ${scopeLabel}\n\n`);
    if (tool.description) {
      tooltip.appendMarkdown(`${tool.description}\n\n`);
    }
    tooltip.appendMarkdown(`Source: \`${tool.source.filePath}\``);
    item.tooltip = tooltip;

    // Context value for menu contributions
    item.contextValue = `tool:${tool.type}:${tool.status}:${tool.scope}`;

    // Command: only for leaf nodes (not collapsible MCP servers)
    // Plan 02 will register the handler for this command
    if (!hasChildren) {
      item.command = {
        command: 'agent-config-keeper.openToolSource',
        title: 'Open Tool Source',
        arguments: [tool],
      };
    }

    return item;
  }

  private createSubToolItem(node: SubToolNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      vscode.TreeItemCollapsibleState.None,
    );
    item.iconPath = new vscode.ThemeIcon('symbol-property');
    item.description = node.detail;
    return item;
  }
}
