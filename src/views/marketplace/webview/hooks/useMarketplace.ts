import { useState, useEffect, useMemo, useCallback } from 'react';
import { useVSCodeApi } from './useVSCodeApi';
import { useDebounce } from './useDebounce';
import type {
  ExtensionMessage,
  RegistryEntryWithSource,
} from '../../marketplace.messages';

export type ToolTypeFilter = 'all' | 'skill' | 'mcp_server' | 'hook' | 'command';
export type SortOption = 'popular' | 'recent' | 'alphabetical';

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
  const [installedToolIds, setInstalledToolIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          setInstalledToolIds(new Set(message.toolIds));
          break;
        case 'readmeLoading':
          setReadmeLoading(true);
          break;
        case 'readmeData':
          setReadmeContent(message.markdown);
          setReadmeLoading(false);
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

  // --- Computed: filtered + sorted + paginated tools ---
  const filteredTools = useMemo(() => {
    let result = tools;

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

    // Sort
    switch (sortBy) {
      case 'popular':
        result = [...result].sort((a, b) => b.stars - a.stars);
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
  }, [tools, activeType, debouncedSearch, sortBy]);

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
    loading,
    error,

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
  };
}
