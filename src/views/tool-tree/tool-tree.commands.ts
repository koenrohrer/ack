import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';
import type { NormalizedTool } from '../../types/config.js';
import type { ToolTreeProvider } from './tool-tree.provider.js';
import { getRouteForTool, getJsonPath } from './tool-tree.command-utils.js';

// Re-export pure functions so consumers can import from this module
export { getRouteForTool, getJsonPath } from './tool-tree.command-utils.js';

// ---------------------------------------------------------------------------
// Module-level highlight decoration (RESEARCH: never recreate per call)
// ---------------------------------------------------------------------------

const highlightDecoration = vscode.window.createTextEditorDecorationType({
  backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
  isWholeLine: true,
});

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

/**
 * Register all tool tree command handlers.
 *
 * Commands:
 * - `agent-config-keeper.openToolSource`: Opens the source file for a tool.
 *   Skills/commands open in markdown preview; MCP servers/hooks open their
 *   JSON config scrolled to the relevant entry with a brief highlight.
 * - `agent-config-keeper.refreshToolTree`: Triggers a full tree refresh.
 */
export function registerToolTreeCommands(
  context: vscode.ExtensionContext,
  treeProvider: ToolTreeProvider,
): void {
  const openCmd = vscode.commands.registerCommand(
    'agent-config-keeper.openToolSource',
    async (tool: NormalizedTool) => {
      if (!tool?.source?.filePath) {
        return;
      }

      const route = getRouteForTool(tool);
      if (route === 'markdown') {
        await openMarkdownFile(tool.source.filePath);
      } else {
        const jsonPath = getJsonPath(tool);
        await openJsonAtKey(tool.source.filePath, jsonPath);
      }
    },
  );

  const refreshCmd = vscode.commands.registerCommand(
    'agent-config-keeper.refreshToolTree',
    async () => {
      await treeProvider.refresh();
    },
  );

  context.subscriptions.push(openCmd, refreshCmd);
}

// ---------------------------------------------------------------------------
// File opening helpers
// ---------------------------------------------------------------------------

/**
 * Open a markdown file. If already open in a tab, focus it.
 * Otherwise open in VS Code's built-in rendered markdown preview.
 */
async function openMarkdownFile(filePath: string): Promise<void> {
  const uri = vscode.Uri.file(filePath);

  // Check if file is already open in a tab
  if (isFileOpenInTab(filePath)) {
    await vscode.window.showTextDocument(uri, { preview: false });
    return;
  }

  // Open in rendered markdown preview
  // Pass URI directly to handle case where markdown extension is not yet loaded (pitfall #6)
  await vscode.commands.executeCommand('markdown.showPreview', uri);
}

/**
 * Open a JSON config file scrolled to the entry at `jsonPath`.
 *
 * Uses jsonc-parser to find the exact byte offset of the target key,
 * then opens the file with that range selected, centered, and
 * temporarily highlighted for 1.5 seconds.
 *
 * Falls back to opening the file without scrolling if the path
 * is not found or the file cannot be parsed.
 */
async function openJsonAtKey(
  filePath: string,
  jsonPath: (string | number)[],
): Promise<void> {
  const uri = vscode.Uri.file(filePath);
  const doc = await vscode.workspace.openTextDocument(uri);

  // If jsonPath is empty or parse fails, just open the file
  if (jsonPath.length === 0) {
    await vscode.window.showTextDocument(doc, { preview: false });
    return;
  }

  const tree = jsonc.parseTree(doc.getText());
  if (!tree) {
    await vscode.window.showTextDocument(doc, { preview: false });
    return;
  }

  const node = jsonc.findNodeAtLocation(tree, jsonPath);
  if (!node) {
    // Graceful fallback: open without scrolling
    await vscode.window.showTextDocument(doc, { preview: false });
    return;
  }

  const startPos = doc.positionAt(node.offset);
  const endPos = doc.positionAt(node.offset + node.length);
  const range = new vscode.Range(startPos, endPos);

  const editor = await vscode.window.showTextDocument(doc, {
    selection: range,
    preview: false,
  });

  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  applyTemporaryHighlight(editor, range);
}

// ---------------------------------------------------------------------------
// Tab reuse detection
// ---------------------------------------------------------------------------

/**
 * Check whether a file is already open in any VS Code tab.
 */
function isFileOpenInTab(filePath: string): boolean {
  for (const tabGroup of vscode.window.tabGroups.all) {
    for (const tab of tabGroup.tabs) {
      if (
        tab.input instanceof vscode.TabInputText &&
        tab.input.uri.fsPath === filePath
      ) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Temporary highlight
// ---------------------------------------------------------------------------

/**
 * Apply a temporary highlight decoration to a range in an editor.
 * The highlight is cleared after 1500ms.
 */
function applyTemporaryHighlight(
  editor: vscode.TextEditor,
  range: vscode.Range,
): void {
  editor.setDecorations(highlightDecoration, [range]);

  setTimeout(() => {
    editor.setDecorations(highlightDecoration, []);
  }, 1500);
}
