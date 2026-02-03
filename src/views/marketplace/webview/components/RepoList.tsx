import type { SavedRepoInfo } from '../../marketplace.messages';

// Import progress ring for scanning state
import '@vscode-elements/elements/dist/vscode-progress-ring/index.js';

interface RepoListProps {
  repos: SavedRepoInfo[];
  scanning: Set<string>;
  errors: Map<string, string>;
  onRemove: (url: string) => void;
  onRefresh: (url: string) => void;
}

/**
 * Renders the list of saved repositories with remove/refresh actions.
 * Shows scanning spinner and error states per repo.
 */
export function RepoList({ repos, scanning, errors, onRemove, onRefresh }: RepoListProps) {
  return (
    <div className="repo-list">
      {repos.map((repo) => {
        const isScanning = scanning.has(repo.url);
        const error = errors.get(repo.url);

        return (
          <div key={repo.url} className="repo-list__item">
            <div className="repo-list__info">
              <span className="repo-list__name">{repo.repoFullName}</span>
              {isScanning ? (
                <span className="repo-list__status">
                  <vscode-progress-ring className="repo-list__spinner" />
                  <span>Scanning...</span>
                </span>
              ) : error ? (
                <span className="repo-list__error">{error}</span>
              ) : (
                <span className="repo-list__count">
                  {repo.toolCount} tool{repo.toolCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="repo-list__actions">
              <button
                className="repo-list__action"
                onClick={(e) => { e.stopPropagation(); onRefresh(repo.url); }}
                disabled={isScanning}
                title="Refresh"
              >
                &#x21bb;
              </button>
              <button
                className="repo-list__action repo-list__action--remove"
                onClick={(e) => { e.stopPropagation(); onRemove(repo.url); }}
                title="Remove"
              >
                &#x2715;
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
