import { useState, useEffect } from 'react';
import { useMarketplace, normalizeToolName } from './hooks/useMarketplace';
import { useVSCodeApi } from './hooks/useVSCodeApi';
import { SearchBar } from './components/SearchBar';
import { TypeTabs } from './components/TypeTabs';
import { SortDropdown } from './components/SortDropdown';
import { MarketplaceGrid } from './components/MarketplaceGrid';
import { Pagination } from './components/Pagination';
import { ToolDetailView } from './components/ToolDetailView';
import { RepoInput } from './components/RepoInput';
import { RepoList } from './components/RepoList';
import type { ExtensionMessage } from '../marketplace.messages';

// Import progress ring web component
import '@vscode-elements/elements/dist/vscode-progress-ring/index.js';

export function App() {
  const {
    tools,
    totalTools,
    installedToolIds,
    loading,
    error,

    savedRepos,
    repoScanning,
    repoErrors,

    searchQuery,
    activeType,
    sortBy,
    currentPage,
    totalPages,

    selectedTool,
    readmeContent,
    readmeLoading,

    setSearchQuery,
    setActiveType,
    setSortBy,
    setCurrentPage,

    selectTool,
    goBack,
    refresh,
    requestInstall,
    submitConfig,
    retryInstall,
    requestUninstall,
    getInstallState,
    addRepo,
    removeRepo,
    refreshRepo,
    openExternal,
  } = useMarketplace();

  const { postMessage: vscodePostMessage } = useVSCodeApi();
  const [agentChangedName, setAgentChangedName] = useState<string | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent<ExtensionMessage>) => {
      if (event.data.type === 'agentChanged') {
        setAgentChangedName(event.data.agentName);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleRefreshAfterAgentChange = () => {
    setAgentChangedName(null);
    vscodePostMessage({ type: 'ready' });
  };

  // --- Agent changed banner (shared across all views) ---
  const agentBanner = agentChangedName !== null ? (
    <div
      className="agent-changed-banner"
      style={{
        padding: '8px 12px',
        marginBottom: '8px',
        background: 'var(--vscode-editorWidget-background)',
        border: '1px solid var(--vscode-editorWidget-border)',
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
      }}
    >
      <span>Agent changed to <strong>{agentChangedName}</strong>. Data shown may be outdated.</span>
      <button
        className="marketplace-filters__tab"
        onClick={handleRefreshAfterAgentChange}
        style={{ whiteSpace: 'nowrap' }}
      >
        Refresh
      </button>
    </div>
  ) : null;

  // --- Detail view ---
  if (selectedTool) {
    return (
      <div className="marketplace">
        {agentBanner}
        <ToolDetailView
          tool={selectedTool}
          readmeContent={readmeContent}
          readmeLoading={readmeLoading}
          isInstalled={installedToolIds.has(normalizeToolName(selectedTool.name))}
          installState={getInstallState(selectedTool.id)}
          onBack={goBack}
          onInstall={() => requestInstall(selectedTool)}
          onRetry={() => retryInstall(selectedTool.id, selectedTool.sourceId)}
          onUninstall={() => requestUninstall(selectedTool.name)}
          onSubmitConfig={(values) =>
            submitConfig(selectedTool.id, selectedTool.sourceId, values)
          }
          onOpenExternal={openExternal}
        />
      </div>
    );
  }

  // --- Loading state ---
  if (loading) {
    return (
      <div className="marketplace">
        {agentBanner}
        <div className="marketplace-loading">
          <vscode-progress-ring />
          <span className="marketplace-loading__text">
            Loading marketplace...
          </span>
        </div>
      </div>
    );
  }

  // --- Error state ---
  if (error) {
    return (
      <div className="marketplace">
        {agentBanner}
        <div className="marketplace-error">
          <div className="marketplace-error__message">{error}</div>
          <button className="marketplace-filters__tab" onClick={refresh}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // --- Main grid view ---
  return (
    <div className="marketplace">
      {agentBanner}
      <div className="marketplace-header">
        <h1 className="marketplace-header__title">Tool Marketplace</h1>
        <SearchBar value={searchQuery} onChange={setSearchQuery} />
        <div className="marketplace-header__filter-row">
          <TypeTabs activeType={activeType} onChange={setActiveType} />
          <SortDropdown value={sortBy} onChange={setSortBy} />
        </div>
        <RepoInput onAdd={addRepo} />
        {savedRepos.length > 0 && (
          <RepoList
            repos={savedRepos}
            scanning={repoScanning}
            errors={repoErrors}
            onRemove={removeRepo}
            onRefresh={refreshRepo}
          />
        )}
      </div>

      <MarketplaceGrid
        tools={tools}
        installedToolIds={installedToolIds}
        getInstallState={getInstallState}
        onSelect={selectTool}
        onInstall={requestInstall}
        onRetry={(tool) => retryInstall(tool.id, tool.sourceId)}
      />

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={totalTools}
        onPageChange={setCurrentPage}
      />
    </div>
  );
}
