import { useState, useEffect } from 'react';
import { useVSCodeApi } from './hooks/useVSCodeApi';
import type { ExtensionMessage } from '../marketplace.messages';

// Import progress ring web component
import '@vscode-elements/elements/dist/vscode-progress-ring/index.js';

/** Persisted webview state shape */
interface MarketplaceState {
  loading: boolean;
}

export function App() {
  const { postMessage, getState, setState } = useVSCodeApi();
  const [loading, setLoading] = useState(true);

  // Restore persisted state on mount
  useEffect(() => {
    const saved = getState<MarketplaceState>();
    if (saved) {
      setLoading(saved.loading);
    }
  }, []);

  // Listen for messages from extension
  useEffect(() => {
    const handler = (event: MessageEvent<ExtensionMessage>) => {
      const message = event.data;
      switch (message.type) {
        case 'registryLoading':
          setLoading(true);
          break;
        case 'registryData':
          setLoading(false);
          break;
        case 'registryError':
          setLoading(false);
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Persist state when loading changes
  useEffect(() => {
    setState<MarketplaceState>({ loading });
  }, [loading]);

  // Signal ready to extension
  useEffect(() => {
    postMessage({ type: 'ready' });
  }, []);

  if (loading) {
    return (
      <div className="marketplace">
        <div className="marketplace-loading">
          <vscode-progress-ring />
          <span className="marketplace-loading__text">
            Loading marketplace...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="marketplace">
      <div className="marketplace-header">
        <h1 className="marketplace-header__title">Tool Marketplace</h1>
        <p style={{ color: 'var(--vscode-descriptionForeground)' }}>
          Browse and install agent tools. Content coming in Plan 03.
        </p>
      </div>
      <div className="marketplace-empty">
        <div className="marketplace-empty__title">Marketplace Ready</div>
        <div className="marketplace-empty__description">
          The marketplace scaffold is loaded. Search, cards, and detail views
          will be added in the next plan.
        </div>
      </div>
    </div>
  );
}
