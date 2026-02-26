import type { ToolTypeFilter } from '../hooks/useMarketplace';

interface TypeTabsProps {
  activeType: ToolTypeFilter;
  onChange: (type: ToolTypeFilter) => void;
  supportedTypes?: Set<string>;
}

const TABS: { value: ToolTypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'skill', label: 'Skills' },
  { value: 'mcp_server', label: 'MCP Servers' },
  { value: 'hook', label: 'Hooks' },
  { value: 'command', label: 'Commands' },
  { value: 'custom_prompt', label: 'Instructions' },
];

/**
 * Horizontal tab bar for filtering tools by type.
 * Filters tabs based on supported tool types for the active agent.
 */
export function TypeTabs({ activeType, onChange, supportedTypes }: TypeTabsProps) {
  // Filter tabs: show 'all' always, plus types the agent supports
  const visibleTabs = supportedTypes && supportedTypes.size > 0
    ? TABS.filter((tab) =>
        tab.value === 'all' || supportedTypes.has(tab.value)
      )
    : TABS; // Show all if no supportedTypes provided (backward compat)

  return (
    <div className="marketplace-filters">
      {visibleTabs.map((tab) => (
        <button
          key={tab.value}
          className={`marketplace-filters__tab${
            activeType === tab.value ? ' marketplace-filters__tab--active' : ''
          }`}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
