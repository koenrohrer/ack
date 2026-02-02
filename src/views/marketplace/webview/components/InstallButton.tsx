import type { InstallState } from '../hooks/useMarketplace';

// Import progress ring for loading states
import '@vscode-elements/elements/dist/vscode-progress-ring/index.js';

interface InstallButtonProps {
  installState: InstallState;
  isInstalled: boolean;
  onInstall: () => void;
  onRetry: () => void;
  onUninstall?: () => void;
  variant?: 'card' | 'detail';
}

/** Status text for each progress phase. */
const PROGRESS_LABELS: Record<string, string> = {
  downloading: 'Downloading...',
  writing: 'Installing...',
  verifying: 'Verifying...',
  configuring: 'Configuring...',
};

/**
 * Reusable install button that renders different visual states
 * based on the install lifecycle.
 *
 * - idle + not installed: "Install" primary button
 * - idle + installed: "Installed" badge (detail variant adds Update + Uninstall)
 * - downloading/writing/verifying/configuring: spinner + status text
 * - error: error text + "Retry" button
 * - installed (just completed): same as idle + installed
 */
export function InstallButton({
  installState,
  isInstalled,
  onInstall,
  onRetry,
  onUninstall,
  variant = 'card',
}: InstallButtonProps) {
  const { status, error } = installState;

  // Progress states (downloading, writing, verifying, configuring)
  if (status in PROGRESS_LABELS) {
    return (
      <div className="install-progress">
        <vscode-progress-ring />
        <span>{PROGRESS_LABELS[status]}</span>
      </div>
    );
  }

  // Error state
  if (status === 'error') {
    return (
      <div className="install-error">
        <span className="install-error__text">{error ?? 'Install failed'}</span>
        <button
          className="tool-card__install-btn"
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  // Installed state (either from installState.status or from installedToolIds)
  if (status === 'installed' || (status === 'idle' && isInstalled)) {
    if (variant === 'detail') {
      return (
        <div className="tool-detail__actions">
          <span className="installed-badge">Installed</span>
          <button
            className="tool-card__install-btn install-btn--update"
            onClick={(e) => {
              e.stopPropagation();
              onInstall();
            }}
          >
            Update
          </button>
          {onUninstall && (
            <button
              className="tool-card__install-btn install-btn--uninstall"
              onClick={(e) => {
                e.stopPropagation();
                onUninstall();
              }}
            >
              Uninstall
            </button>
          )}
        </div>
      );
    }

    // Card variant: just the badge
    return <span className="installed-badge">Installed</span>;
  }

  // Idle + not installed: primary install button
  return (
    <button
      className="tool-card__install-btn tool-card__install-btn--primary"
      onClick={(e) => {
        e.stopPropagation();
        onInstall();
      }}
    >
      Install
    </button>
  );
}
