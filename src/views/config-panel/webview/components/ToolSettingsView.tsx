import { useCallback } from 'react';
import type { ToolInfo, ConfigPanelWebMessage } from '../../config-panel.messages';

// Import web components used in this component
import '@vscode-elements/elements/dist/vscode-button/index.js';
import '@vscode-elements/elements/dist/vscode-badge/index.js';
import '@vscode-elements/elements/dist/vscode-icon/index.js';
import '@vscode-elements/elements/dist/vscode-divider/index.js';

/** Display labels for tool types. */
const TYPE_LABELS: Record<string, string> = {
  skill: 'Skill',
  mcp_server: 'MCP Server',
  hook: 'Hook',
  command: 'Command',
};

interface ToolSettingsViewProps {
  tool: ToolInfo;
  postMessage: (msg: ConfigPanelWebMessage) => void;
  onBack: () => void;
}

/**
 * Read-only detail view for non-MCP tools (skills, hooks, commands).
 *
 * Displays tool metadata and provides an "Open Source File" button
 * that sends a message to the extension host to open the file in the editor.
 */
export function ToolSettingsView({ tool, postMessage, onBack }: ToolSettingsViewProps) {
  const handleOpenFile = useCallback(() => {
    if (tool.filePath) {
      postMessage({ type: 'openToolFile', filePath: tool.filePath });
    }
  }, [tool.filePath, postMessage]);

  const statusClass = tool.status === 'disabled'
    ? 'tool-view__badge--disabled'
    : tool.status === 'error'
      ? 'tool-view__badge--error'
      : 'tool-view__badge--enabled';

  return (
    <div className="tool-view">
      <div className="tool-view__header">
        <button className="back-btn" title="Back to tool list" onClick={onBack}>
          &larr;
        </button>
        <h2 className="tool-view__title">{tool.name}</h2>
      </div>

      <div className="tool-view__details">
        <div className="tool-view__detail">
          <span className="tool-view__detail-label">Type:</span>
          <span className="tool-view__detail-value">
            {TYPE_LABELS[tool.type] ?? tool.type}
          </span>
        </div>
        <div className="tool-view__detail">
          <span className="tool-view__detail-label">Scope:</span>
          <span className="tool-view__detail-value">{tool.scope}</span>
        </div>
        <div className="tool-view__detail">
          <span className="tool-view__detail-label">Status:</span>
          <span className={`tool-view__badge ${statusClass}`}>
            {tool.status === 'disabled' ? 'Disabled' : tool.status === 'error' ? 'Error' : 'Enabled'}
          </span>
        </div>
        {tool.filePath && (
          <div className="tool-view__detail">
            <span className="tool-view__detail-label">Source:</span>
            <code className="tool-view__detail-value tool-view__detail-path">
              {tool.filePath}
            </code>
          </div>
        )}
      </div>

      <vscode-divider />

      {tool.filePath && (
        <vscode-button
          appearance="primary"
          onClick={handleOpenFile}
        >
          <vscode-icon name="go-to-file" slot="start" />
          Open Source File
        </vscode-button>
      )}

      <p className="tool-view__note">
        To edit this tool's configuration, open the source file directly.
      </p>
    </div>
  );
}
