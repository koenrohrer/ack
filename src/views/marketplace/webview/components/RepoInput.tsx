import { useState } from 'react';

interface RepoInputProps {
  onAdd: (url: string) => void;
}

/**
 * Text input + "Add" button for adding a GitHub repository URL.
 * Validates URL format before submitting.
 */
export function RepoInput({ onAdd }: RepoInputProps) {
  const [url, setUrl] = useState('');

  const isValid = /^(https?:\/\/)?(www\.)?github\.com\/[^/]+\/[^/]+/.test(url.trim()) ||
    /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(url.trim());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (trimmed && isValid) {
      onAdd(trimmed);
      setUrl('');
    }
  };

  return (
    <form className="add-repo-form" onSubmit={handleSubmit}>
      <input
        type="text"
        className="add-repo-form__input"
        placeholder="Add repository URL (e.g., github.com/owner/repo)"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <button
        type="submit"
        className="add-repo-form__button"
        disabled={!url.trim() || !isValid}
      >
        Add
      </button>
    </form>
  );
}
