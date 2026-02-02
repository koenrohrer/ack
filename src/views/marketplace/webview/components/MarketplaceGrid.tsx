import type { RegistryEntryWithSource } from '../../marketplace.messages';
import type { InstallState } from '../hooks/useMarketplace';
import { ToolCard } from './ToolCard';

interface MarketplaceGridProps {
  tools: RegistryEntryWithSource[];
  installedToolIds: Set<string>;
  getInstallState: (toolId: string) => InstallState;
  onSelect: (tool: RegistryEntryWithSource) => void;
  onInstall: (tool: RegistryEntryWithSource) => void;
  onRetry: (tool: RegistryEntryWithSource) => void;
}

/**
 * Responsive grid of ToolCards with an empty-state fallback.
 */
export function MarketplaceGrid({
  tools,
  installedToolIds,
  getInstallState,
  onSelect,
  onInstall,
  onRetry,
}: MarketplaceGridProps) {
  if (tools.length === 0) {
    return (
      <div className="marketplace-empty">
        <div className="marketplace-empty__icon">&#128270;</div>
        <div className="marketplace-empty__title">No tools found</div>
        <div className="marketplace-empty__description">
          Try adjusting your search or filter criteria.
        </div>
      </div>
    );
  }

  return (
    <div className="marketplace-grid">
      {tools.map((tool) => (
        <ToolCard
          key={`${tool.sourceId}:${tool.id}`}
          tool={tool}
          isInstalled={installedToolIds.has(tool.name)}
          installState={getInstallState(tool.id)}
          onClick={() => onSelect(tool)}
          onInstall={() => onInstall(tool)}
          onRetry={() => onRetry(tool)}
        />
      ))}
    </div>
  );
}
