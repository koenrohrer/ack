import { useState, useRef, useEffect, useCallback } from 'react';
import type { ProfileInfo, ConfigPanelWebMessage } from '../../config-panel.messages';

// Import web components used in this component
import '@vscode-elements/elements/dist/vscode-button/index.js';
import '@vscode-elements/elements/dist/vscode-textfield/index.js';
import '@vscode-elements/elements/dist/vscode-badge/index.js';
import '@vscode-elements/elements/dist/vscode-icon/index.js';

interface ProfileListProps {
  profiles: ProfileInfo[];
  activeProfileId: string | null;
  switching: boolean;
  postMessage: (msg: ConfigPanelWebMessage) => void;
  onSelectProfile: (id: string) => void;
}

/**
 * Profile list with create, rename, delete, and switch actions.
 *
 * Displays all saved profiles with the active profile highlighted,
 * and provides inline editing for name changes and a creation form.
 */
export function ProfileList({
  profiles,
  activeProfileId,
  switching,
  postMessage,
  onSelectProfile,
}: ProfileListProps) {
  // --- Create form state ---
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const createInputRef = useRef<HTMLElement>(null);

  // --- Rename state ---
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLElement>(null);

  // Attach native input event for create textfield
  useEffect(() => {
    const el = createInputRef.current;
    if (!el) {
      return;
    }
    const handler = (e: Event) => {
      setCreateName((e.target as HTMLInputElement).value);
    };
    el.addEventListener('input', handler);
    return () => el.removeEventListener('input', handler);
  }, [showCreate]);

  // Attach native input event for rename textfield
  useEffect(() => {
    const el = renameInputRef.current;
    if (!el) {
      return;
    }
    const handler = (e: Event) => {
      setRenameValue((e.target as HTMLInputElement).value);
    };
    el.addEventListener('input', handler);
    return () => el.removeEventListener('input', handler);
  }, [renamingId]);

  // --- Handlers ---
  const handleCreate = useCallback(() => {
    const trimmed = createName.trim();
    if (!trimmed) {
      return;
    }
    postMessage({ type: 'createProfile', name: trimmed });
    setCreateName('');
    setShowCreate(false);
  }, [createName, postMessage]);

  const handleRename = useCallback(
    (id: string) => {
      const trimmed = renameValue.trim();
      if (!trimmed) {
        setRenamingId(null);
        return;
      }
      postMessage({ type: 'renameProfile', id, name: trimmed });
      setRenamingId(null);
    },
    [renameValue, postMessage],
  );

  const handleDelete = useCallback(
    (id: string) => {
      postMessage({ type: 'deleteProfile', id });
    },
    [postMessage],
  );

  const handleSwitch = useCallback(
    (id: string | null) => {
      postMessage({ type: 'switchProfile', id });
    },
    [postMessage],
  );

  const startRename = useCallback((id: string, currentName: string) => {
    setRenamingId(id);
    setRenameValue(currentName);
  }, []);

  return (
    <div className="profile-list">
      {/* Create profile button / form */}
      {showCreate ? (
        <div className="profile-list__create">
          <vscode-textfield
            ref={createInputRef}
            placeholder="Profile name"
            value={createName}
            autofocus
          />
          <div className="profile-list__create-actions">
            <vscode-button
              appearance="primary"
              onClick={handleCreate}
            >
              Create
            </vscode-button>
            <vscode-button
              appearance="secondary"
              onClick={() => {
                setShowCreate(false);
                setCreateName('');
              }}
            >
              Cancel
            </vscode-button>
          </div>
        </div>
      ) : (
        <vscode-button
          appearance="primary"
          onClick={() => setShowCreate(true)}
        >
          Create Profile
        </vscode-button>
      )}

      {/* Current environment option (deactivate profiles) */}
      <div
        className={`profile-list__item ${activeProfileId === null ? 'profile-list__item--active' : ''}`}
      >
        <div className="profile-list__item-info">
          <span className="profile-list__item-name">
            Current Environment
          </span>
          {activeProfileId === null && (
            <vscode-badge>Active</vscode-badge>
          )}
        </div>
        <div className="profile-list__actions">
          {activeProfileId !== null && (
            <vscode-button
              appearance="secondary"
              disabled={switching}
              onClick={() => handleSwitch(null)}
            >
              Switch
            </vscode-button>
          )}
        </div>
      </div>

      <vscode-divider />

      {/* Profile list */}
      {profiles.length === 0 ? (
        <p className="profile-list__empty">
          No profiles yet. Create one to save a tool configuration preset.
        </p>
      ) : (
        profiles.map((profile) => {
          const isActive = profile.id === activeProfileId;
          const isRenaming = profile.id === renamingId;

          return (
            <div
              key={profile.id}
              className={`profile-list__item ${isActive ? 'profile-list__item--active' : ''}`}
            >
              <div className="profile-list__item-info">
                {isRenaming ? (
                  <div className="profile-list__rename">
                    <vscode-textfield
                      ref={renameInputRef}
                      value={renameValue}
                      autofocus
                    />
                    <vscode-button
                      appearance="primary"
                      onClick={() => handleRename(profile.id)}
                    >
                      Save
                    </vscode-button>
                    <vscode-button
                      appearance="secondary"
                      onClick={() => setRenamingId(null)}
                    >
                      Cancel
                    </vscode-button>
                  </div>
                ) : (
                  <>
                    <span className="profile-list__item-name">
                      {profile.name}
                    </span>
                    {isActive && <vscode-badge>Active</vscode-badge>}
                    <span className="profile-list__item-tools">
                      {profile.toolCount} {profile.toolCount === 1 ? 'tool' : 'tools'}
                    </span>
                  </>
                )}
              </div>

              {!isRenaming && (
                <div className="profile-list__actions">
                  {/* Switch to / Deactivate */}
                  {isActive ? (
                    <vscode-button
                      appearance="secondary"
                      disabled={switching}
                      onClick={() => handleSwitch(null)}
                    >
                      Deactivate
                    </vscode-button>
                  ) : (
                    <vscode-button
                      appearance="secondary"
                      disabled={switching}
                      onClick={() => handleSwitch(profile.id)}
                    >
                      Switch
                    </vscode-button>
                  )}

                  {/* Edit tools */}
                  <vscode-button
                    appearance="secondary"
                    onClick={() => onSelectProfile(profile.id)}
                  >
                    Edit
                  </vscode-button>

                  {/* Rename */}
                  <vscode-button
                    appearance="secondary"
                    onClick={() => startRename(profile.id, profile.name)}
                  >
                    Rename
                  </vscode-button>

                  {/* Delete */}
                  <vscode-button
                    appearance="secondary"
                    onClick={() => handleDelete(profile.id)}
                  >
                    Delete
                  </vscode-button>
                </div>
              )}
            </div>
          );
        })
      )}

      {switching && (
        <div className="profile-list__switching">
          <vscode-progress-ring />
          <span>Switching profile...</span>
        </div>
      )}
    </div>
  );
}
