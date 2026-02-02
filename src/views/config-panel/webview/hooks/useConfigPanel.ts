import { useState, useEffect, useCallback } from 'react';
import { useVSCodeApi } from './useVSCodeApi';
import type {
  ConfigPanelExtMessage,
  ConfigPanelWebMessage,
  McpSettingsInfo,
  ProfileInfo,
  ProfileToolInfo,
  ToolInfo,
} from '../../config-panel.messages';

export type TabId = 'profiles' | 'tools';

/** Persisted state shape for VS Code webview state API. */
interface PersistedState {
  activeTab: TabId;
  selectedProfileId: string | null;
  selectedToolKey: string | null;
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

  // --- Profile editor state ---
  const [selectedProfileId, setSelectedProfileIdState] = useState<string | null>(null);
  const [profileTools, setProfileTools] = useState<ProfileToolInfo[]>([]);
  const [switching, setSwitching] = useState(false);

  // --- Tool settings state ---
  const [selectedToolKey, setSelectedToolKeyState] = useState<string | null>(null);
  const [mcpSettings, setMcpSettings] = useState<McpSettingsInfo | null>(null);
  const [toolSettingsLoading, setToolSettingsLoading] = useState(false);

  // --- UI state ---
  const [activeTab, setActiveTabState] = useState<TabId>('profiles');

  // --- Restore persisted state on mount ---
  useEffect(() => {
    const saved = getState<PersistedState>();
    if (saved?.activeTab) {
      setActiveTabState(saved.activeTab);
    }
    if (saved?.selectedProfileId) {
      setSelectedProfileIdState(saved.selectedProfileId);
    }
    if (saved?.selectedToolKey) {
      setSelectedToolKeyState(saved.selectedToolKey);
    }
  }, []);

  // --- Persist state on change ---
  useEffect(() => {
    setState<PersistedState>({ activeTab, selectedProfileId, selectedToolKey });
  }, [activeTab, selectedProfileId, selectedToolKey]);

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
        case 'profileToolsData':
          if (message.profileId === selectedProfileId) {
            setProfileTools(message.tools);
          }
          break;
        case 'mcpSettings':
          if (message.toolKey === selectedToolKey) {
            setMcpSettings(message.settings);
            setToolSettingsLoading(false);
          }
          break;
        case 'profileSwitching':
          setSwitching(true);
          break;
        case 'profileSwitchComplete':
          setSwitching(false);
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
  }, [selectedProfileId, selectedToolKey]);

  // --- Signal ready on mount ---
  useEffect(() => {
    postMessage({ type: 'ready' } satisfies ConfigPanelWebMessage);
  }, []);

  // --- Request profile tools when selectedProfileId changes ---
  useEffect(() => {
    if (selectedProfileId) {
      postMessage({
        type: 'requestProfileTools',
        id: selectedProfileId,
      } satisfies ConfigPanelWebMessage);
    } else {
      setProfileTools([]);
    }
  }, [selectedProfileId]);

  // --- Request MCP settings when a tool is selected ---
  useEffect(() => {
    if (selectedToolKey) {
      // Check if the selected tool is an MCP server
      const tool = tools.find((t) => t.key === selectedToolKey);
      if (tool && tool.type === 'mcp_server') {
        // Use the tool name directly as serverName (it is the MCP server name)
        setToolSettingsLoading(true);
        setMcpSettings(null);
        postMessage({
          type: 'requestMcpSettings',
          toolKey: selectedToolKey,
          serverName: tool.name,
          scope: tool.scope,
        } satisfies ConfigPanelWebMessage);
      } else {
        setMcpSettings(null);
        setToolSettingsLoading(false);
      }
    } else {
      setMcpSettings(null);
      setToolSettingsLoading(false);
    }
  }, [selectedToolKey, tools]);

  // --- Tab switching ---
  const setActiveTab = useCallback((tab: TabId) => {
    setActiveTabState(tab);
  }, []);

  // --- Selected profile ---
  const setSelectedProfileId = useCallback((id: string | null) => {
    setSelectedProfileIdState(id);
  }, []);

  // --- Selected tool ---
  const setSelectedToolKey = useCallback((key: string | null) => {
    setSelectedToolKeyState(key);
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

    // Profile editor
    selectedProfileId,
    setSelectedProfileId,
    profileTools,
    switching,

    // Tool settings
    selectedToolKey,
    setSelectedToolKey,
    mcpSettings,
    toolSettingsLoading,

    // UI state
    activeTab,
    setActiveTab,

    // Messaging
    postMessage: sendMessage,
  };
}
