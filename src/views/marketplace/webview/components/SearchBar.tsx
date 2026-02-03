interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (query: string) => void;
}

/**
 * Search input for filtering marketplace tools.
 *
 * `onChange` fires on every keystroke for live registry filtering.
 * `onSubmit` fires on Enter or button click for explicit GitHub search.
 */
export function SearchBar({ value, onChange, onSubmit }: SearchBarProps) {
  return (
    <form
      className="marketplace-header__search"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
    >
      <input
        type="text"
        className="marketplace-header__search-input"
        placeholder="Search tools by name, description, author, or tags..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus
      />
      <button type="submit" className="marketplace-header__search-button">
        Search GitHub
      </button>
    </form>
  );
}
