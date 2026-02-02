import 'react';

/**
 * TypeScript declarations for @vscode-elements web components used in React JSX.
 *
 * React 19 supports custom elements natively but TypeScript needs
 * the JSX intrinsic element declarations for type checking.
 */
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'vscode-button': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          appearance?: 'primary' | 'secondary' | 'icon';
          disabled?: boolean;
        },
        HTMLElement
      >;
      'vscode-badge': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
      'vscode-textfield': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          placeholder?: string;
          value?: string;
          type?: string;
          autofocus?: boolean;
          readonly?: boolean;
        },
        HTMLElement
      >;
      'vscode-form-group': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          variant?: 'horizontal' | 'vertical';
        },
        HTMLElement
      >;
      'vscode-label': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          required?: boolean;
        },
        HTMLElement
      >;
      'vscode-progress-ring': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
      'vscode-divider': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
      'vscode-tabs': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          selectedIndex?: number;
          panel?: boolean;
        },
        HTMLElement
      >;
      'vscode-tab-header': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
      'vscode-tab-panel': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
      'vscode-icon': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          name?: string;
          'action-icon'?: boolean;
        },
        HTMLElement
      >;
    }
  }
}
