import { describe, expect, it } from 'vitest';
import {
  applyMcpEnvUpdate,
  canToggleMcpStatus,
} from '../../views/config-panel/config-panel.mcp-utils.js';

// Capability shapes as returned by each provider's getMcpContainerKey()/getMcpDisableField().
const CLAUDE = { key: 'mcpServers', disable: { field: 'disabled', disabledValue: true } };
const CODEX = { key: 'mcp_servers', disable: { field: 'enabled', disabledValue: false } };
const COPILOT = { key: 'servers', disable: undefined };

describe('config panel MCP update helpers', () => {
  it('exposes status toggle only for providers that persist MCP status', () => {
    expect(canToggleMcpStatus(CLAUDE.disable)).toBe(true);
    expect(canToggleMcpStatus(CODEX.disable)).toBe(true);
    expect(canToggleMcpStatus(COPILOT.disable)).toBe(false);
  });

  it('updates Claude-style mcpServers env and disabled flag', () => {
    const current = {
      other: true,
      mcpServers: {
        github: {
          command: 'node',
          env: { OLD: 'value' },
        },
      },
    };

    const updated = applyMcpEnvUpdate(
      current,
      CLAUDE.key,
      CLAUDE.disable,
      'github',
      { TOKEN: 'secret' },
      true,
    );

    expect(updated).toEqual({
      other: true,
      mcpServers: {
        github: {
          command: 'node',
          env: { TOKEN: 'secret' },
          disabled: true,
        },
      },
    });
  });

  it('updates Copilot servers env without writing Claude mcpServers', () => {
    const current = {
      inputs: [{ id: 'token', type: 'promptString' }],
      servers: {
        github: {
          type: 'stdio',
          command: 'node',
          env: { OLD: 'value' },
        },
      },
    };

    const updated = applyMcpEnvUpdate(
      current,
      COPILOT.key,
      COPILOT.disable,
      'github',
      { TOKEN: 'secret' },
      true,
    );

    expect(updated).toEqual({
      inputs: [{ id: 'token', type: 'promptString' }],
      servers: {
        github: {
          type: 'stdio',
          command: 'node',
          env: { TOKEN: 'secret' },
        },
      },
    });
    expect(updated).not.toHaveProperty('mcpServers');
  });

  it('updates Codex TOML mcp_servers env and enabled flag', () => {
    const current = {
      model: 'gpt-5',
      mcp_servers: {
        github: {
          command: 'node',
          env: { OLD: 'value' },
        },
      },
    };

    const disabled = applyMcpEnvUpdate(
      current,
      CODEX.key,
      CODEX.disable,
      'github',
      { TOKEN: 'secret' },
      true,
    );

    expect(disabled).toEqual({
      model: 'gpt-5',
      mcp_servers: {
        github: {
          command: 'node',
          env: { TOKEN: 'secret' },
          enabled: false,
        },
      },
    });

    const enabled = applyMcpEnvUpdate(
      disabled,
      CODEX.key,
      CODEX.disable,
      'github',
      { TOKEN: 'secret' },
      false,
    );

    expect(enabled).toEqual({
      model: 'gpt-5',
      mcp_servers: {
        github: {
          command: 'node',
          env: { TOKEN: 'secret' },
        },
      },
    });
  });
});
