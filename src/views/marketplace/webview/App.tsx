import { useMarketplace } from './hooks/useMarketplace';
import { SearchBar } from './components/SearchBar';
import { TypeTabs } from './components/TypeTabs';
import { SortDropdown } from './components/SortDropdown';
import { MarketplaceGrid } from './components/MarketplaceGrid';
import { Pagination } from './components/Pagination';
import { ToolDetailView } from './components/ToolDetailView';

// Import progress ring web component
import '@vscode-elements/elements/dist/vscode-progress-ring/index.js';

export function App() {
  const {
    tools,
    totalTools,
    installedToolIds,
    loading,
    error,

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
  } = useMarketplace();

  // --- Detail view ---
  if (selectedTool) {
    return (
      <div className="marketplace">
        <ToolDetailView
          tool={selectedTool}
          readmeContent={readmeContent}
          readmeLoading={readmeLoading}
          isInstalled={installedToolIds.has(selectedTool.name)}
          installState={getInstallState(selectedTool.id)}
          onBack={goBack}
          onInstall={() => requestInstall(selectedTool)}
          onRetry={() => retryInstall(selectedTool.id, selectedTool.sourceId)}
          onUninstall={() => requestUninstall(selectedTool.name)}
          onSubmitConfig={(values) =>
            submitConfig(selectedTool.id, selectedTool.sourceId, values)
          }
        />
      </div>
    );
  }

  // --- Loading state ---
  if (loading) {
    return (
      <div className="marketplace">
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
      <div className="marketplace-header">
        <h1 className="marketplace-header__title">Tool Marketplace</h1>
        <SearchBar value={searchQuery} onChange={setSearchQuery} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <TypeTabs activeType={activeType} onChange={setActiveType} />
          <SortDropdown value={sortBy} onChange={setSortBy} />
        </div>
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
