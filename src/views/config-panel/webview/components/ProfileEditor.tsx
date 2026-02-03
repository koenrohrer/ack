import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { ProfileInfo, ProfileToolInfo, ConfigPanelWebMessage } from '../../config-panel.messages';

// Import web components used in this component
import '@vscode-elements/elements/dist/vscode-button/index.js';
import '@vscode-elements/elements/dist/vscode-checkbox/index.js';
import '@vscode-elements/elements/dist/vscode-divider/index.js';

/** Display labels for tool types. */
const TYPE_LABELS: Record<string, string> = {
  skill: 'Skills',
  mcp_server: 'MCP Servers',
  hook: 'Hooks',
  command: 'Commands',
};

/** Ordering for type groups. */
const TYPE_ORDER = ['skill', 'mcp_server', 'hook', 'command'];

interface ProfileEditorProps {
  profile: ProfileInfo;
  profileTools: ProfileToolInfo[];
  postMessage: (msg: ConfigPanelWebMessage) => void;
  onBack: () => void;
}

/**
 * Profile tool editor with checkbox toggles per tool.
 *
 * Groups tools by type and allows the user to include/exclude
 * tools from the profile via checkboxes.
 */
export function ProfileEditor({
  profile,
  profileTools,
  postMessage,
  onBack,
}: ProfileEditorProps) {
  // Track checkbox states locally for immediate feedback
  const [toolStates, setToolStates] = useState<Map<string, boolean>>(() => {
    const map = new Map<string, boolean>();
    for (const tool of profileTools) {
      map.set(tool.key, tool.enabled);
    }
    return map;
  });

  // Track refs for checkboxes to attach native change events
  const checkboxRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Reset local state when profileTools changes (e.g. after save)
  useEffect(() => {
    const map = new Map<string, boolean>();
    for (const tool of profileTools) {
      map.set(tool.key, tool.enabled);
    }
    setToolStates(map);
  }, [profileTools]);

  // Attach native change events to checkboxes
  useEffect(() => {
    const handlers = new Map<HTMLElement, EventListener>();

    for (const [key, el] of checkboxRefs.current) {
      const handler = (e: Event) => {
        const checked = (e.target as HTMLInputElement).checked;
        setToolStates((prev) => {
          const next = new Map(prev);
          next.set(key, checked);
          return next;
        });
      };
      el.addEventListener('change', handler);
      handlers.set(el, handler);
    }

    return () => {
      for (const [el, handler] of handlers) {
        el.removeEventListener('change', handler);
      }
    };
  }, [profileTools]);

  // Group tools by type
  const toolGroups = useMemo(() => {
    const groups = new Map<string, ProfileToolInfo[]>();
    for (const tool of profileTools) {
      const existing = groups.get(tool.type);
      if (existing) {
        existing.push(tool);
      } else {
        groups.set(tool.type, [tool]);
      }
    }
    return groups;
  }, [profileTools]);

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

  // Check if there are changes to save
  const hasChanges = useMemo(() => {
    for (const tool of profileTools) {
      if (toolStates.get(tool.key) !== tool.enabled) {
        return true;
      }
    }
    return false;
  }, [profileTools, toolStates]);

  const handleSave = useCallback(() => {
    const tools: { key: string; enabled: boolean }[] = [];
    for (const tool of profileTools) {
      tools.push({
        key: tool.key,
        enabled: toolStates.get(tool.key) ?? tool.enabled,
      });
    }
    postMessage({ type: 'updateProfileTools', id: profile.id, tools });
  }, [profileTools, toolStates, postMessage, profile.id]);

  const setCheckboxRef = useCallback((key: string) => {
    return (el: HTMLElement | null) => {
      if (el) {
        checkboxRefs.current.set(key, el);
      } else {
        checkboxRefs.current.delete(key);
      }
    };
  }, []);

  return (
    <div className="profile-editor">
      <div className="profile-editor__header">
        <button className="back-btn" title="Back to profile list" onClick={onBack}>
          &larr;
        </button>
        <h2 className="profile-editor__title">
          Edit Profile: {profile.name}
        </h2>
      </div>

      {profileTools.length === 0 ? (
        <p className="profile-editor__empty">
          No tools available. Install tools to add them to this profile.
        </p>
      ) : (
        <>
          {sortedGroupKeys.map((typeKey) => {
            const tools = toolGroups.get(typeKey) ?? [];
            return (
              <div key={typeKey} className="profile-editor__group">
                <h3 className="profile-editor__group-title">
                  {TYPE_LABELS[typeKey] ?? typeKey}
                </h3>
                {tools.map((tool) => {
                  const isStale = tool.name.endsWith('(not found)');
                  const checked = toolStates.get(tool.key) ?? false;

                  return (
                    <div
                      key={tool.key}
                      className={`profile-editor__tool ${isStale ? 'profile-editor__tool--stale' : ''}`}
                    >
                      <vscode-checkbox
                        ref={setCheckboxRef(tool.key)}
                        checked={checked || undefined}
                        disabled={isStale || undefined}
                        label={tool.name}
                      >
                        {tool.name}
                      </vscode-checkbox>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </>
      )}

      <vscode-divider />

      <div className="profile-editor__actions">
        <vscode-button
          appearance="primary"
          disabled={!hasChanges || undefined}
          onClick={handleSave}
        >
          Save Changes
        </vscode-button>
        <vscode-button
          appearance="secondary"
          onClick={onBack}
        >
          Cancel
        </vscode-button>
      </div>
    </div>
  );
}
