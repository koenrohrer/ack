import { useState, useCallback, useRef, useEffect } from 'react';
import type { McpSettingsInfo, ConfigPanelWebMessage, ToolInfo } from '../../config-panel.messages';

// Import web components used in this component
import '@vscode-elements/elements/dist/vscode-button/index.js';
import '@vscode-elements/elements/dist/vscode-textfield/index.js';
import '@vscode-elements/elements/dist/vscode-checkbox/index.js';
import '@vscode-elements/elements/dist/vscode-form-group/index.js';
import '@vscode-elements/elements/dist/vscode-label/index.js';
import '@vscode-elements/elements/dist/vscode-icon/index.js';
import '@vscode-elements/elements/dist/vscode-divider/index.js';

interface McpSettingsFormProps {
  tool: ToolInfo;
  settings: McpSettingsInfo;
  postMessage: (msg: ConfigPanelWebMessage) => void;
  onBack: () => void;
}

interface EnvEntry {
  id: string;
  key: string;
  value: string;
}

let nextEnvId = 0;

function makeEnvEntries(env: Record<string, string>): EnvEntry[] {
  return Object.entries(env).map(([key, value]) => ({
    id: `env-${nextEnvId++}`,
    key,
    value,
  }));
}

/**
 * Editable form for MCP server environment variables.
 *
 * Displays read-only server info (command, args, transport) at the top,
 * an enabled/disabled toggle, and an editable env var section with
 * add/remove capability. Uses ref-based native event binding for
 * web component textfields (same pattern as ConfigForm in marketplace).
 */
export function McpSettingsForm({ tool, settings, postMessage, onBack }: McpSettingsFormProps) {
  const serverName = tool.name;
  const isManaged = tool.isManaged;

  // Local env state for editing
  const [envEntries, setEnvEntries] = useState<EnvEntry[]>(() =>
    makeEnvEntries(settings.env),
  );
  const [enabled, setEnabled] = useState(!settings.disabled);

  // Track refs for textfield event binding
  const fieldRefs = useRef<Map<string, HTMLElement>>(new Map());
  const enabledCheckboxRef = useRef<HTMLElement>(null);

  // Reset local state when settings change (e.g., after save)
  useEffect(() => {
    setEnvEntries(makeEnvEntries(settings.env));
    setEnabled(!settings.disabled);
  }, [settings]);

  // Register a ref for a textfield element
  const registerFieldRef = useCallback((refKey: string, el: HTMLElement | null) => {
    if (el) {
      fieldRefs.current.set(refKey, el);
    } else {
      fieldRefs.current.delete(refKey);
    }
  }, []);

  // Attach native input listeners to all env textfields
  useEffect(() => {
    const listeners = new Map<HTMLElement, EventListener>();

    for (const [refKey, el] of fieldRefs.current) {
      const listener = (e: Event) => {
        const target = e.target as HTMLInputElement;
        const [type, id] = refKey.split(':', 2);

        setEnvEntries((prev) =>
          prev.map((entry) => {
            if (entry.id !== id) {
              return entry;
            }
            return type === 'key'
              ? { ...entry, key: target.value }
              : { ...entry, value: target.value };
          }),
        );
      };
      el.addEventListener('input', listener);
      listeners.set(el, listener);
    }

    return () => {
      for (const [el, listener] of listeners) {
        el.removeEventListener('input', listener);
      }
    };
  }, [envEntries.length]);

  // Attach native change event to enabled checkbox
  useEffect(() => {
    const el = enabledCheckboxRef.current;
    if (!el) {
      return;
    }
    const handler = (e: Event) => {
      setEnabled((e.target as HTMLInputElement).checked);
    };
    el.addEventListener('change', handler);
    return () => el.removeEventListener('change', handler);
  }, []);

  const handleAddEnvVar = useCallback(() => {
    setEnvEntries((prev) => [
      ...prev,
      { id: `env-${nextEnvId++}`, key: '', value: '' },
    ]);
  }, []);

  const handleRemoveEnvVar = useCallback((id: string) => {
    setEnvEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const handleSave = useCallback(() => {
    // Collect env vars (skip entries with empty keys)
    const env: Record<string, string> = {};
    for (const entry of envEntries) {
      const trimmedKey = entry.key.trim();
      if (trimmedKey) {
        env[trimmedKey] = entry.value;
      }
    }

    postMessage({
      type: 'updateMcpEnv',
      toolKey: tool.key,
      serverName,
      scope: tool.scope,
      env,
      disabled: !enabled,
    });
  }, [envEntries, enabled, serverName, tool.key, tool.scope, postMessage]);

  return (
    <div className="mcp-form">
      <div className="mcp-form__header">
        <vscode-button
          appearance="icon"
          title="Back to tool list"
          onClick={onBack}
        >
          <vscode-icon name="arrow-left" />
        </vscode-button>
        <h2 className="mcp-form__title">MCP Server: {serverName}</h2>
      </div>

      {/* Read-only server info */}
      <div className="mcp-form__info">
        <div className="mcp-form__info-row">
          <span className="mcp-form__info-label">Command:</span>
          <code className="mcp-form__info-value">{settings.command}</code>
        </div>
        {settings.args.length > 0 && (
          <div className="mcp-form__info-row">
            <span className="mcp-form__info-label">Args:</span>
            <code className="mcp-form__info-value">{settings.args.join(' ')}</code>
          </div>
        )}
        {settings.transport && (
          <div className="mcp-form__info-row">
            <span className="mcp-form__info-label">Transport:</span>
            <code className="mcp-form__info-value">{settings.transport}</code>
          </div>
        )}
        {settings.url && (
          <div className="mcp-form__info-row">
            <span className="mcp-form__info-label">URL:</span>
            <code className="mcp-form__info-value">{settings.url}</code>
          </div>
        )}
      </div>

      <vscode-divider />

      {/* Enabled/Disabled toggle */}
      <div className="mcp-form__toggle">
        <vscode-checkbox
          ref={enabledCheckboxRef}
          checked={enabled || undefined}
          disabled={isManaged || undefined}
        >
          Enabled
        </vscode-checkbox>
      </div>

      <vscode-divider />

      {/* Environment Variables section */}
      <div className="mcp-form__env">
        <h3 className="mcp-form__env-title">Environment Variables</h3>

        {envEntries.length === 0 && (
          <p className="mcp-form__env-empty">
            No environment variables configured.
          </p>
        )}

        {envEntries.map((entry) => (
          <div key={entry.id} className="mcp-form__row">
            <vscode-form-group variant="vertical" className="mcp-form__row-field">
              <vscode-label>Key</vscode-label>
              <vscode-textfield
                ref={(el: HTMLElement | null) => registerFieldRef(`key:${entry.id}`, el)}
                value={entry.key}
                placeholder="VARIABLE_NAME"
                readonly={isManaged || undefined}
              />
            </vscode-form-group>
            <vscode-form-group variant="vertical" className="mcp-form__row-field">
              <vscode-label>Value</vscode-label>
              <vscode-textfield
                ref={(el: HTMLElement | null) => registerFieldRef(`value:${entry.id}`, el)}
                value={entry.value}
                placeholder="value"
                readonly={isManaged || undefined}
              />
            </vscode-form-group>
            {!isManaged && (
              <vscode-button
                appearance="icon"
                title="Remove variable"
                className="mcp-form__row-remove"
                onClick={() => handleRemoveEnvVar(entry.id)}
              >
                <vscode-icon name="trash" />
              </vscode-button>
            )}
          </div>
        ))}

        {!isManaged && (
          <vscode-button
            appearance="secondary"
            onClick={handleAddEnvVar}
          >
            Add Variable
          </vscode-button>
        )}
      </div>

      <vscode-divider />

      {/* Save / Cancel actions */}
      {!isManaged && (
        <div className="mcp-form__actions">
          <vscode-button
            appearance="primary"
            onClick={handleSave}
          >
            Save
          </vscode-button>
          <vscode-button
            appearance="secondary"
            onClick={onBack}
          >
            Cancel
          </vscode-button>
        </div>
      )}

      {isManaged && (
        <p className="mcp-form__managed-note">
          This server is managed by your organization and cannot be edited.
        </p>
      )}
    </div>
  );
}
