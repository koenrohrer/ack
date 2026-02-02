import type { RegistryEntryWithSource } from '../../marketplace.messages';
import { ToolCard } from './ToolCard';

interface MarketplaceGridProps {
  tools: RegistryEntryWithSource[];
  installedToolIds: Set<string>;
  onSelect: (tool: RegistryEntryWithSource) => void;
  onInstall: (tool: RegistryEntryWithSource) => void;
}

/**
 * Responsive grid of ToolCards with an empty-state fallback.
 */
export function MarketplaceGrid({
  tools,
  installedToolIds,
  onSelect,
  onInstall,
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
          onClick={() => onSelect(tool)}
          onInstall={() => onInstall(tool)}
        />
      ))}
    </div>
  );
}
