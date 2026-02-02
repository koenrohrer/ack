import type { ToolTypeFilter } from '../hooks/useMarketplace';

interface TypeTabsProps {
  activeType: ToolTypeFilter;
  onChange: (type: ToolTypeFilter) => void;
}

const TABS: { value: ToolTypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'skill', label: 'Skills' },
  { value: 'mcp_server', label: 'MCP Servers' },
  { value: 'hook', label: 'Hooks' },
  { value: 'command', label: 'Commands' },
];

/**
 * Horizontal tab bar for filtering tools by type.
 */
export function TypeTabs({ activeType, onChange }: TypeTabsProps) {
  return (
    <div className="marketplace-filters">
      {TABS.map((tab) => (
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
