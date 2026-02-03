import { useRef, useEffect, useCallback, useMemo } from 'react';
import { useConfigPanel } from './hooks/useConfigPanel';
import type { TabId } from './hooks/useConfigPanel';
import { ProfileList } from './components/ProfileList';
import { ProfileEditor } from './components/ProfileEditor';
import { ToolList } from './components/ToolList';
import { McpSettingsForm } from './components/McpSettingsForm';
import { ToolSettingsView } from './components/ToolSettingsView';

// Import tab web components
import '@vscode-elements/elements/dist/vscode-tabs/index.js';
import '@vscode-elements/elements/dist/vscode-tab-header/index.js';
import '@vscode-elements/elements/dist/vscode-tab-panel/index.js';

const TAB_IDS: TabId[] = ['profiles', 'tools'];

export function App() {
  const {
    profiles,
    activeProfileId,
    tools,
    loading,
    error,
    activeTab,
    setActiveTab,
    selectedProfileId,
    setSelectedProfileId,
    profileTools,
    switching,
    selectedToolKey,
    setSelectedToolKey,
    mcpSettings,
    toolSettingsLoading,
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

  // Find the selected tool info for tool settings
  const selectedTool = useMemo(
    () => tools.find((t) => t.key === selectedToolKey) ?? null,
    [tools, selectedToolKey],
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

  // Determine which tool settings view to show
  const renderToolSettings = () => {
    if (!selectedToolKey || !selectedTool) {
      return (
        <ToolList
          tools={tools}
          selectedToolKey={selectedToolKey}
          onSelectTool={setSelectedToolKey}
        />
      );
    }

    // MCP server: show editable form or loading spinner
    if (selectedTool.type === 'mcp_server') {
      if (toolSettingsLoading) {
        return (
          <div className="config-panel__loading">
            <p>Loading settings...</p>
          </div>
        );
      }
      if (mcpSettings) {
        return (
          <McpSettingsForm
            tool={selectedTool}
            settings={mcpSettings}
            postMessage={postMessage}
            onBack={() => setSelectedToolKey(null)}
          />
        );
      }
      // Settings failed to load -- show error and back button
      return (
        <div className="tool-view">
          <div className="tool-view__header">
            <vscode-button
              icon="arrow-left"
              icon-only
              secondary
              title="Back to tool list"
              onClick={() => setSelectedToolKey(null)}
            />
            <h2 className="tool-view__title">{selectedTool.name}</h2>
          </div>
          <p className="tool-view__note">Failed to load MCP settings.</p>
        </div>
      );
    }

    // Non-MCP tools: show read-only detail view
    return (
      <ToolSettingsView
        tool={selectedTool}
        postMessage={postMessage}
        onBack={() => setSelectedToolKey(null)}
      />
    );
  };

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
            {renderToolSettings()}
          </div>
        </vscode-tab-panel>
      </vscode-tabs>
    </div>
  );
}
