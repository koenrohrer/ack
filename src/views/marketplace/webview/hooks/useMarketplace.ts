import { useState, useEffect, useMemo, useCallback } from 'react';
import { useVSCodeApi } from './useVSCodeApi';
import { useDebounce } from './useDebounce';
import type {
  ExtensionMessage,
  RegistryEntryWithSource,
  ConfigField,
  InstalledToolInfo,
  SavedRepoInfo,
} from '../../marketplace.messages';

export type ToolTypeFilter = 'all' | 'skill' | 'mcp_server' | 'hook' | 'command';
export type SortOption = 'popular' | 'recent' | 'alphabetical';

/** Per-tool install state tracked independently for parallel install support. */
export interface InstallState {
  status: 'idle' | 'downloading' | 'configuring' | 'writing' | 'verifying' | 'installed' | 'error';
  error?: string;
  configFields?: ConfigField[];
}

const DEFAULT_INSTALL_STATE: InstallState = { status: 'idle' };

/** Normalize a tool name for comparison (lowercased, spaces/underscores -> hyphens, .disabled stripped). */
export function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/\.disabled$/, '').replace(/[\s_]+/g, '-');
}

const ITEMS_PER_PAGE = 24;

/** Persisted state shape for VS Code webview state API. */
interface PersistedState {
  searchQuery: string;
  activeType: ToolTypeFilter;
  sortBy: SortOption;
  currentPage: number;
}

/**
 * Central state management hook for the marketplace UI.
 *
 * Manages tools list, filtering, sorting, pagination, detail view state,
 * and communication with the extension host.
 */
export function useMarketplace() {
  const { postMessage, getState, setState } = useVSCodeApi();

  // --- Core data ---
  const [tools, setTools] = useState<RegistryEntryWithSource[]>([]);
  const [installedTools, setInstalledTools] = useState<InstalledToolInfo[]>([]);
  const [installStates, setInstallStates] = useState<Map<string, InstallState>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- Repo state ---
  const [repoTools, setRepoTools] = useState<RegistryEntryWithSource[]>([]);
  const [savedRepos, setSavedRepos] = useState<SavedRepoInfo[]>([]);
  const [repoScanning, setRepoScanning] = useState<Set<string>>(new Set());
  const [repoErrors, setRepoErrors] = useState<Map<string, string>>(new Map());

  // Derived Set of normalized installed tool names for cross-name-format lookup.
  const installedToolIds = useMemo(
    () => new Set(installedTools.map((t) => normalizeToolName(t.name))),
    [installedTools],
  );

  // --- UI state ---
  const [searchQuery, setSearchQuery] = useState('');
  const [activeType, setActiveType] = useState<ToolTypeFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('popular');
  const [currentPage, setCurrentPage] = useState(1);

  // --- Detail view ---
  const [selectedTool, setSelectedToolState] = useState<RegistryEntryWithSource | null>(null);
  const [readmeContent, setReadmeContent] = useState<string | null>(null);
  const [readmeLoading, setReadmeLoading] = useState(false);

  const debouncedSearch = useDebounce(searchQuery, 300);

  // --- Restore persisted state on mount ---
  useEffect(() => {
    const saved = getState<PersistedState>();
    if (saved) {
      setSearchQuery(saved.searchQuery ?? '');
      setActiveType(saved.activeType ?? 'all');
      setSortBy(saved.sortBy ?? 'popular');
      setCurrentPage(saved.currentPage ?? 1);
    }
  }, []);

  // --- Persist UI state on change ---
  useEffect(() => {
    setState<PersistedState>({
      searchQuery,
      activeType,
      sortBy,
      currentPage,
    });
  }, [searchQuery, activeType, sortBy, currentPage]);

  // --- Listen for extension messages ---
  useEffect(() => {
    const handler = (event: MessageEvent<ExtensionMessage>) => {
      const message = event.data;
      switch (message.type) {
        case 'registryLoading':
          setLoading(true);
          setError(null);
          break;
        case 'registryData':
          setTools(message.tools);
          setLoading(false);
          setError(null);
          break;
        case 'registryError':
          setLoading(false);
          setError(message.error);
          break;
        case 'installedTools':
          setInstalledTools(message.tools);
          break;
        case 'installProgress':
          setInstallStates((prev) => new Map(prev).set(message.toolId, { status: message.status }));
          break;
        case 'installComplete':
          setInstallStates((prev) => new Map(prev).set(message.toolId, { status: 'installed' }));
          setInstalledTools((prev) => [
            ...prev,
            { name: message.toolId, type: '', scope: message.scope },
          ]);
          break;
        case 'installError':
          setInstallStates((prev) =>
            new Map(prev).set(message.toolId, { status: 'error', error: message.error }),
          );
          break;
        case 'installCancelled':
          setInstallStates((prev) => new Map(prev).set(message.toolId, { status: 'idle' }));
          break;
        case 'installConfigRequired':
          setInstallStates((prev) =>
            new Map(prev).set(message.toolId, {
              status: 'configuring',
              configFields: message.fields,
            }),
          );
          break;
        case 'readmeLoading':
          setReadmeLoading(true);
          break;
        case 'readmeData':
          setReadmeContent(message.markdown);
          setReadmeLoading(false);
          break;
        case 'repoTools':
          setRepoTools(message.tools);
          break;
        case 'savedRepos':
          setSavedRepos(message.repos);
          break;
        case 'repoScanLoading':
          setRepoScanning((prev) => new Set(prev).add(message.repoUrl));
          setRepoErrors((prev) => {
            const next = new Map(prev);
            next.delete(message.repoUrl);
            return next;
          });
          break;
        case 'repoScanComplete':
          setRepoScanning((prev) => {
            const next = new Set(prev);
            next.delete(message.repoUrl);
            return next;
          });
          break;
        case 'repoScanError':
          setRepoScanning((prev) => {
            const next = new Set(prev);
            next.delete(message.repoUrl);
            return next;
          });
          setRepoErrors((prev) => new Map(prev).set(message.repoUrl, message.error));
          break;
        case 'repoRemoved':
          setRepoScanning((prev) => {
            const next = new Set(prev);
            next.delete(message.repoUrl);
            return next;
          });
          setRepoErrors((prev) => {
            const next = new Map(prev);
            next.delete(message.repoUrl);
            return next;
          });
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // --- Signal ready on mount ---
  useEffect(() => {
    postMessage({ type: 'ready' });
  }, []);

  // --- Merge registry and repo tools ---
  const allTools = useMemo(() => {
    return [...tools, ...repoTools];
  }, [tools, repoTools]);

  // --- Computed: filtered + sorted + paginated tools ---
  const filteredTools = useMemo(() => {
    let result = allTools;

    // Filter by type
    if (activeType !== 'all') {
      result = result.filter((t) => t.toolType === activeType);
    }

    // Filter by search query (debounced)
    if (debouncedSearch) {
      const query = debouncedSearch.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          t.description.toLowerCase().includes(query) ||
          t.author.toLowerCase().includes(query) ||
          t.tags.some((tag) => tag.toLowerCase().includes(query)),
      );
    }

    // Sort -- use relevanceScore when available for interleaving
    switch (sortBy) {
      case 'popular':
        result = [...result].sort((a, b) => {
          const scoreA = a.relevanceScore ?? a.stars;
          const scoreB = b.relevanceScore ?? b.stars;
          return scoreB - scoreA;
        });
        break;
      case 'recent':
        result = [...result].sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
        break;
      case 'alphabetical':
        result = [...result].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
        break;
    }

    return result;
  }, [allTools, activeType, debouncedSearch, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredTools.length / ITEMS_PER_PAGE));

  // Clamp page when filters change
  const safePage = Math.min(currentPage, totalPages);
  if (safePage !== currentPage) {
    setCurrentPage(safePage);
  }

  const paginatedTools = useMemo(() => {
    const start = (safePage - 1) * ITEMS_PER_PAGE;
    return filteredTools.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredTools, safePage]);

  // --- Actions ---
  const selectTool = useCallback(
    (tool: RegistryEntryWithSource) => {
      setSelectedToolState(tool);
      setReadmeContent(null);
      setReadmeLoading(true);
      postMessage({
        type: 'requestReadme',
        toolId: tool.id,
        sourceId: tool.sourceId,
        readmePath: tool.readmePath,
      });
    },
    [postMessage],
  );

  const goBack = useCallback(() => {
    setSelectedToolState(null);
    setReadmeContent(null);
    setReadmeLoading(false);
  }, []);

  const refresh = useCallback(() => {
    postMessage({ type: 'requestRegistry', forceRefresh: true });
  }, [postMessage]);

  const requestInstall = useCallback(
    (tool: RegistryEntryWithSource) => {
      postMessage({
        type: 'requestInstall',
        toolId: tool.id,
        sourceId: tool.sourceId,
      });
    },
    [postMessage],
  );

  const submitConfig = useCallback(
    (toolId: string, sourceId: string, values: Record<string, string>) => {
      postMessage({ type: 'submitConfig', toolId, sourceId, values });
    },
    [postMessage],
  );

  const retryInstall = useCallback(
    (toolId: string, sourceId: string) => {
      postMessage({ type: 'retryInstall', toolId, sourceId });
    },
    [postMessage],
  );

  const requestUninstall = useCallback(
    (toolId: string) => {
      postMessage({ type: 'requestUninstall', toolId });
    },
    [postMessage],
  );

  const getInstallState = useCallback(
    (toolId: string): InstallState => {
      return installStates.get(toolId) ?? DEFAULT_INSTALL_STATE;
    },
    [installStates],
  );

  const getInstalledInfo = useCallback(
    (toolName: string): InstalledToolInfo | undefined => {
      const normalized = normalizeToolName(toolName);
      return installedTools.find((t) => normalizeToolName(t.name) === normalized);
    },
    [installedTools],
  );

  // --- Repo actions ---
  const addRepo = useCallback((url: string) => {
    postMessage({ type: 'addRepo', url });
  }, [postMessage]);

  const removeRepo = useCallback((url: string) => {
    postMessage({ type: 'removeRepo', url });
  }, [postMessage]);

  const refreshRepo = useCallback((url: string) => {
    postMessage({ type: 'refreshRepo', url });
  }, [postMessage]);

  const openExternal = useCallback((url: string) => {
    postMessage({ type: 'openExternal', url });
  }, [postMessage]);

  // --- Reset page when search/type changes ---
  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
    setCurrentPage(1);
  }, []);

  const handleTypeChange = useCallback((type: ToolTypeFilter) => {
    setActiveType(type);
    setCurrentPage(1);
  }, []);

  return {
    // Data
    tools: paginatedTools,
    totalTools: filteredTools.length,
    installedToolIds,
    installedTools,
    installStates,
    loading,
    error,

    // Repo state
    repoTools,
    savedRepos,
    repoScanning,
    repoErrors,

    // UI state
    searchQuery,
    activeType,
    sortBy,
    currentPage,
    totalPages,

    // Detail view
    selectedTool,
    readmeContent,
    readmeLoading,

    // Setters
    setSearchQuery: handleSearchChange,
    setActiveType: handleTypeChange,
    setSortBy,
    setCurrentPage,

    // Actions
    selectTool,
    goBack,
    refresh,
    requestInstall,
    submitConfig,
    retryInstall,
    requestUninstall,
    getInstallState,
    getInstalledInfo,
    addRepo,
    removeRepo,
    refreshRepo,
    openExternal,
  };
}
