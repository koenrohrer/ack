import { useMemo } from 'react';
import type { ToolInfo } from '../../config-panel.messages';

// Import web components used in this component
import '@vscode-elements/elements/dist/vscode-button/index.js';
import '@vscode-elements/elements/dist/vscode-badge/index.js';
import '@vscode-elements/elements/dist/vscode-icon/index.js';

/** Display labels for tool types. */
const TYPE_LABELS: Record<string, string> = {
  skill: 'Skills',
  mcp_server: 'MCP Servers',
  hook: 'Hooks',
  command: 'Commands',
};

/** Ordering for type groups. */
const TYPE_ORDER = ['mcp_server', 'skill', 'hook', 'command'];

interface ToolListProps {
  tools: ToolInfo[];
  selectedToolKey: string | null;
  onSelectTool: (key: string) => void;
}

/**
 * Filterable tool list with type grouping and selection.
 *
 * Displays all installed tools grouped by type. The user clicks a tool
 * to view/edit its settings. MCP servers are marked as "Editable";
 * other types are "View Only". Managed scope tools show a read-only badge.
 */
export function ToolList({ tools, selectedToolKey, onSelectTool }: ToolListProps) {
  // Group tools by type
  const toolGroups = useMemo(() => {
    const groups = new Map<string, ToolInfo[]>();
    for (const tool of tools) {
      const existing = groups.get(tool.type);
      if (existing) {
        existing.push(tool);
      } else {
        groups.set(tool.type, [tool]);
      }
    }
    return groups;
  }, [tools]);

  // Sort groups by TYPE_ORDER
  const sortedGroupKeys = useMemo(() => {
    const keys = [...toolGroups.keys()];
    keys.sort((a, b) => {
      const ai = TYPE_ORDER.indexOf(a);
      const bi = TYPE_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
    return keys;
  }, [toolGroups]);

  if (tools.length === 0) {
    return (
      <div className="tool-list">
        <p className="tool-list__empty">
          No tools installed. Visit the Marketplace to discover tools.
        </p>
      </div>
    );
  }

  return (
    <div className="tool-list">
      {sortedGroupKeys.map((typeKey) => {
        const groupTools = toolGroups.get(typeKey) ?? [];
        return (
          <div key={typeKey} className="tool-list__group">
            <h3 className="tool-list__group-title">
              {TYPE_LABELS[typeKey] ?? typeKey}
            </h3>
            {groupTools.map((tool) => {
              const isSelected = tool.key === selectedToolKey;
              const statusClass = tool.status === 'disabled'
                ? 'tool-list__badge--disabled'
                : tool.status === 'error'
                  ? 'tool-list__badge--error'
                  : 'tool-list__badge--enabled';

              return (
                <div
                  key={tool.key}
                  className={`tool-list__item ${isSelected ? 'tool-list__item--selected' : ''}`}
                  onClick={() => onSelectTool(tool.key)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectTool(tool.key);
                    }
                  }}
                >
                  <div className="tool-list__item-info">
                    <span className="tool-list__item-name">{tool.name}</span>
                    <span className={`tool-list__badge ${statusClass}`}>
                      {tool.status === 'disabled' ? 'Disabled' : tool.status === 'error' ? 'Error' : 'Enabled'}
                    </span>
                  </div>
                  <div className="tool-list__item-meta">
                    <span className="tool-list__badge tool-list__badge--scope">
                      {tool.scope}
                    </span>
                    {tool.isManaged ? (
                      <span className="tool-list__badge tool-list__badge--managed">
                        Managed (Read-Only)
                      </span>
                    ) : tool.hasEditableSettings ? (
                      <span className="tool-list__badge tool-list__badge--editable">
                        Editable
                      </span>
                    ) : (
                      <span className="tool-list__badge tool-list__badge--view">
                        View
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
