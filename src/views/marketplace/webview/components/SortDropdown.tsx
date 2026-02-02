import type { SortOption } from '../hooks/useMarketplace';

interface SortDropdownProps {
  value: SortOption;
  onChange: (value: SortOption) => void;
}

/**
 * Dropdown for changing tool sort order.
 */
export function SortDropdown({ value, onChange }: SortDropdownProps) {
  return (
    <div className="marketplace-sort">
      <label htmlFor="sort-select">Sort by:</label>
      <select
        id="sort-select"
        className="marketplace-sort__select"
        value={value}
        onChange={(e) => onChange(e.target.value as SortOption)}
      >
        <option value="popular">Popular</option>
        <option value="recent">Recently Updated</option>
        <option value="alphabetical">A-Z</option>
      </select>
    </div>
  );
}
