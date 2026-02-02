import type { RegistryEntryWithSource } from '../../marketplace.messages';
import type { InstallState } from '../hooks/useMarketplace';
import { InstallButton } from './InstallButton';

/** Human-readable labels for tool types. */
const TYPE_LABELS: Record<string, string> = {
  skill: 'Skill',
  mcp_server: 'MCP Server',
  hook: 'Hook',
  command: 'Command',
};

interface ToolCardProps {
  tool: RegistryEntryWithSource;
  isInstalled: boolean;
  installState: InstallState;
  onClick: () => void;
  onInstall: () => void;
  onRetry: () => void;
}

/**
 * A single tool card in the marketplace grid.
 *
 * Shows name, type badge, author, description, tags, stats,
 * and an install button with progress states.
 */
export function ToolCard({
  tool,
  isInstalled,
  installState,
  onClick,
  onInstall,
  onRetry,
}: ToolCardProps) {
  return (
    <div className="tool-card" onClick={onClick} role="button" tabIndex={0}>
      <div className="tool-card__header">
        <div>
          <h3 className="tool-card__name">{tool.name}</h3>
          <div className="tool-card__author">by {tool.author}</div>
        </div>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <span className={`type-badge type-badge--${tool.toolType}`}>
            {TYPE_LABELS[tool.toolType] ?? tool.toolType}
          </span>
        </div>
      </div>

      <div className="tool-card__description">{tool.description}</div>

      <div className="tool-card__footer">
        <div className="tool-card__tags">
          {tool.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="tool-card__tag">
              {tag}
            </span>
          ))}
        </div>
        <div className="tool-card__stats">
          <span title="Stars">{tool.stars} stars</span>
          <span title="Installs">{tool.installs} installs</span>
        </div>
      </div>

      <div style={{ marginTop: '8px', textAlign: 'right' }}>
        <InstallButton
          installState={installState}
          isInstalled={isInstalled}
          onInstall={onInstall}
          onRetry={onRetry}
          variant="card"
        />
      </div>
    </div>
  );
}
