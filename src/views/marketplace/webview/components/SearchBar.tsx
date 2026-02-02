interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Search input for filtering marketplace tools.
 * Styled with VS Code theme variables.
 */
export function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <div className="marketplace-header__search">
      <input
        type="text"
        className="marketplace-header__search-input"
        placeholder="Search tools by name, description, author, or tags..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus
      />
    </div>
  );
}
