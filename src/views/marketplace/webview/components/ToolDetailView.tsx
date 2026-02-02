import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { RegistryEntryWithSource } from '../../marketplace.messages';
import type { InstallState } from '../hooks/useMarketplace';
import { InstallButton } from './InstallButton';
import { ConfigForm } from './ConfigForm';

// Import progress ring for loading state
import '@vscode-elements/elements/dist/vscode-progress-ring/index.js';

/** Human-readable labels for tool types. */
const TYPE_LABELS: Record<string, string> = {
  skill: 'Skill',
  mcp_server: 'MCP Server',
  hook: 'Hook',
  command: 'Command',
};

interface ToolDetailViewProps {
  tool: RegistryEntryWithSource;
  readmeContent: string | null;
  readmeLoading: boolean;
  isInstalled: boolean;
  installState: InstallState;
  onBack: () => void;
  onInstall: () => void;
  onRetry: () => void;
  onUninstall: () => void;
  onSubmitConfig: (values: Record<string, string>) => void;
}

/**
 * Full detail view for a single tool.
 *
 * Shows tool metadata (name, author, type, version, tags, stats),
 * install button with progress states, optional config form,
 * and the rendered README markdown.
 *
 * Markdown is rendered in the browser via marked + DOMPurify for
 * security. This runs in the webview context, not the extension host.
 */
export function ToolDetailView({
  tool,
  readmeContent,
  readmeLoading,
  isInstalled,
  installState,
  onBack,
  onInstall,
  onRetry,
  onUninstall,
  onSubmitConfig,
}: ToolDetailViewProps) {
  const renderedHtml = useMemo(() => {
    if (!readmeContent) return '';
    const raw = marked.parse(readmeContent);
    // marked.parse can return string | Promise<string>; synchronous usage returns string
    const html = typeof raw === 'string' ? raw : '';
    return DOMPurify.sanitize(html);
  }, [readmeContent]);

  const handleCancelConfig = () => {
    // Reset install state by requesting the extension to cancel
    // For now we just visually reset -- the panel handles the cancel on its side
    onInstall(); // Re-trigger install flow (scope picker will appear again)
  };

  return (
    <div className="tool-detail">
      <div className="tool-detail__header">
        <button className="tool-detail__back" onClick={onBack}>
          &larr; Back to Marketplace
        </button>

        <h1 className="tool-detail__title">{tool.name}</h1>

        <div className="tool-detail__meta">
          <span className={`type-badge type-badge--${tool.toolType}`}>
            {TYPE_LABELS[tool.toolType] ?? tool.toolType}
          </span>
          <span>by {tool.author}</span>
          <span>v{tool.version}</span>
          <span>{tool.stars} stars</span>
          <span>{tool.installs} installs</span>
          <span>Source: {tool.sourceName}</span>
        </div>

        <InstallButton
          installState={installState}
          isInstalled={isInstalled}
          onInstall={onInstall}
          onRetry={onRetry}
          onUninstall={onUninstall}
          variant="detail"
        />

        {tool.tags.length > 0 && (
          <div className="tool-card__tags" style={{ marginTop: '8px' }}>
            {tool.tags.map((tag) => (
              <span key={tag} className="tool-card__tag">
                {tag}
              </span>
            ))}
          </div>
        )}

        <p
          style={{
            marginTop: '8px',
            color: 'var(--vscode-descriptionForeground)',
          }}
        >
          {tool.description}
        </p>
      </div>

      {/* Config form shown when tool requires configuration */}
      {installState.status === 'configuring' && installState.configFields && (
        <ConfigForm
          toolName={tool.name}
          fields={installState.configFields}
          onSubmit={onSubmitConfig}
          onCancel={handleCancelConfig}
        />
      )}

      <div className="tool-detail__readme">
        {readmeLoading ? (
          <div className="marketplace-loading">
            <vscode-progress-ring />
            <span className="marketplace-loading__text">
              Loading README...
            </span>
          </div>
        ) : renderedHtml ? (
          <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
        ) : (
          <p style={{ color: 'var(--vscode-descriptionForeground)' }}>
            No README available.
          </p>
        )}
      </div>
    </div>
  );
}
