import { useRef, useEffect, useCallback, useMemo } from 'react';
import { useConfigPanel } from './hooks/useConfigPanel';
import type { TabId } from './hooks/useConfigPanel';
import { ProfileList } from './components/ProfileList';
import { ProfileEditor } from './components/ProfileEditor';

// Import tab web components
import '@vscode-elements/elements/dist/vscode-tabs/index.js';
import '@vscode-elements/elements/dist/vscode-tab-header/index.js';
import '@vscode-elements/elements/dist/vscode-tab-panel/index.js';

const TAB_IDS: TabId[] = ['profiles', 'tools'];

export function App() {
  const {
    profiles,
    activeProfileId,
    loading,
    error,
    activeTab,
    setActiveTab,
    selectedProfileId,
    setSelectedProfileId,
    profileTools,
    switching,
    postMessage,
  } = useConfigPanel();

  const tabsRef = useRef<HTMLElement>(null);

  // Attach native event listener for tab selection changes.
  // vscode-tabs fires 'vsc-tabs-select' on tab change with detail.selectedIndex.
  const handleTabSelect = useCallback(
    (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const index = typeof detail === 'number' ? detail : detail?.selectedIndex;
      if (typeof index === 'number' && TAB_IDS[index]) {
        setActiveTab(TAB_IDS[index]);
      }
    },
    [setActiveTab],
  );

  useEffect(() => {
    const el = tabsRef.current;
    if (!el) {
      return;
    }

    // Try the documented event name first; fall back to 'change'
    el.addEventListener('vsc-tabs-select', handleTabSelect);
    el.addEventListener('change', handleTabSelect);

    return () => {
      el.removeEventListener('vsc-tabs-select', handleTabSelect);
      el.removeEventListener('change', handleTabSelect);
    };
  }, [handleTabSelect]);

  // Find the selected profile info for the editor header
  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  // --- Loading state ---
  if (loading) {
    return (
      <div className="config-panel">
        <h1 className="config-panel__title">Configure Agent</h1>
        <div className="config-panel__loading">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  // --- Error state ---
  if (error) {
    return (
      <div className="config-panel">
        <h1 className="config-panel__title">Configure Agent</h1>
        <div className="config-panel__error">
          <p>{error}</p>
        </div>
      </div>
    );
  }

  const selectedIndex = TAB_IDS.indexOf(activeTab);

  // Determine which profile view to show
  const showEditor = selectedProfileId !== null && selectedProfile !== null && profileTools.length >= 0;

  return (
    <div className="config-panel">
      <h1 className="config-panel__title">Configure Agent</h1>
      <vscode-tabs
        ref={tabsRef}
        selectedIndex={selectedIndex}
        panel
      >
        <vscode-tab-header slot="header">Profiles</vscode-tab-header>
        <vscode-tab-header slot="header">Tool Settings</vscode-tab-header>
        <vscode-tab-panel>
          <div className="config-panel__tab-content">
            {showEditor && selectedProfile ? (
              <ProfileEditor
                profile={selectedProfile}
                profileTools={profileTools}
                postMessage={postMessage}
                onBack={() => setSelectedProfileId(null)}
              />
            ) : (
              <ProfileList
                profiles={profiles}
                activeProfileId={activeProfileId}
                switching={switching}
                postMessage={postMessage}
                onSelectProfile={setSelectedProfileId}
              />
            )}
          </div>
        </vscode-tab-panel>
        <vscode-tab-panel>
          <div className="config-panel__tab-content">
            <p>Tool settings coming soon.</p>
          </div>
        </vscode-tab-panel>
      </vscode-tabs>
    </div>
  );
}
