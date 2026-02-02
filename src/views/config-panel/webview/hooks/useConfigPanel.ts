import { useState, useEffect, useCallback } from 'react';
import { useVSCodeApi } from './useVSCodeApi';
import type {
  ConfigPanelExtMessage,
  ConfigPanelWebMessage,
  ProfileInfo,
  ToolInfo,
} from '../../config-panel.messages';

export type TabId = 'profiles' | 'tools';

/** Persisted state shape for VS Code webview state API. */
interface PersistedState {
  activeTab: TabId;
}

/**
 * Central state management hook for the configuration panel UI.
 *
 * Manages profiles, tools, active tab, loading state, and
 * communication with the extension host.
 */
export function useConfigPanel() {
  const { postMessage, getState, setState } = useVSCodeApi();

  // --- Core data ---
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- UI state ---
  const [activeTab, setActiveTabState] = useState<TabId>('profiles');

  // --- Restore persisted state on mount ---
  useEffect(() => {
    const saved = getState<PersistedState>();
    if (saved?.activeTab) {
      setActiveTabState(saved.activeTab);
    }
  }, []);

  // --- Persist activeTab on change ---
  useEffect(() => {
    setState<PersistedState>({ activeTab });
  }, [activeTab]);

  // --- Listen for extension messages ---
  useEffect(() => {
    const handler = (event: MessageEvent<ConfigPanelExtMessage>) => {
      const message = event.data;
      switch (message.type) {
        case 'profilesData':
          setProfiles(message.profiles);
          setActiveProfileId(message.activeId);
          break;
        case 'toolsData':
          setTools(message.tools);
          setLoading(false);
          break;
        case 'operationSuccess':
          setError(null);
          break;
        case 'operationError':
          setError(message.error);
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // --- Signal ready on mount ---
  useEffect(() => {
    postMessage({ type: 'ready' } satisfies ConfigPanelWebMessage);
  }, []);

  // --- Tab switching ---
  const setActiveTab = useCallback((tab: TabId) => {
    setActiveTabState(tab);
  }, []);

  // --- Post message helper ---
  const sendMessage = useCallback(
    (message: ConfigPanelWebMessage) => {
      postMessage(message);
    },
    [postMessage],
  );

  return {
    // Data
    profiles,
    activeProfileId,
    tools,
    loading,
    error,

    // UI state
    activeTab,
    setActiveTab,

    // Messaging
    postMessage: sendMessage,
  };
}
