import { useState, useCallback, useRef, useEffect } from 'react';
import type { ConfigField } from '../../marketplace.messages';

// Import vscode-elements form components
import '@vscode-elements/elements/dist/vscode-textfield/index.js';
import '@vscode-elements/elements/dist/vscode-button/index.js';
import '@vscode-elements/elements/dist/vscode-form-group/index.js';
import '@vscode-elements/elements/dist/vscode-label/index.js';

interface ConfigFormProps {
  toolName: string;
  fields: ConfigField[];
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}

/**
 * Multi-field configuration form for tool installation.
 *
 * Displays required fields with asterisks (via vscode-label required prop).
 * Sensitive fields render as password inputs with a show/hide toggle.
 *
 * Uses native DOM event listeners for web component value reading
 * because vscode-textfield is a web component and React's synthetic
 * onChange does not fire for its internal input changes.
 */
export function ConfigForm({ toolName, fields, onSubmit, onCancel }: ConfigFormProps) {
  // Initialize values from field defaults
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of fields) {
      if (field.defaultValue !== undefined) {
        initial[field.key] = field.defaultValue;
      }
    }
    return initial;
  });
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [validationError, setValidationError] = useState<string | null>(null);

  // Store refs to vscode-textfield elements for native event binding
  const fieldRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Stable reference to values setter for use in native event listener
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const registerFieldRef = useCallback((key: string, el: HTMLElement | null) => {
    if (el) {
      fieldRefs.current.set(key, el);
    } else {
      fieldRefs.current.delete(key);
    }
  }, []);

  // Attach native input listeners to web components
  useEffect(() => {
    const listeners = new Map<HTMLElement, EventListener>();

    for (const [key, el] of fieldRefs.current) {
      const listener = (e: Event) => {
        const target = e.target as HTMLInputElement;
        setValues((prev) => ({ ...prev, [key]: target.value }));
      };
      el.addEventListener('input', listener);
      listeners.set(el, listener);
    }

    return () => {
      for (const [el, listener] of listeners) {
        el.removeEventListener('input', listener);
      }
    };
  }, [fields, showPasswords]); // Re-bind when fields change or password visibility toggles

  const togglePasswordVisibility = (key: string) => {
    setShowPasswords((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate required fields
    const missing = fields.filter(
      (f) => f.required && !(values[f.key]?.trim()),
    );
    if (missing.length > 0) {
      const names = missing.map((f) => f.label).join(', ');
      setValidationError(`Required fields missing: ${names}`);
      return;
    }

    setValidationError(null);
    onSubmit(values);
  };

  return (
    <div className="config-form">
      <h3 className="config-form__title">Configure {toolName}</h3>
      <form onSubmit={handleSubmit}>
        {fields.map((field) => (
          <vscode-form-group key={field.key} variant="vertical" className="config-form__field">
            <vscode-label required={field.required}>
              {field.label}
            </vscode-label>
            <vscode-textfield
              ref={(el: HTMLElement | null) => registerFieldRef(field.key, el)}
              type={field.sensitive && !showPasswords[field.key] ? 'password' : 'text'}
              value={values[field.key] ?? ''}
              placeholder={field.description ?? ''}
            />
            {field.sensitive && (
              <button
                type="button"
                className="config-form__toggle-btn"
                onClick={() => togglePasswordVisibility(field.key)}
              >
                {showPasswords[field.key] ? 'Hide' : 'Show'}
              </button>
            )}
            {field.description && (
              <span className="config-form__description">{field.description}</span>
            )}
          </vscode-form-group>
        ))}

        {validationError && (
          <div className="config-form__validation">{validationError}</div>
        )}

        <div className="config-form__actions">
          <button
            type="submit"
            className="tool-card__install-btn tool-card__install-btn--primary"
          >
            Install
          </button>
          <button
            type="button"
            className="tool-card__install-btn"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
