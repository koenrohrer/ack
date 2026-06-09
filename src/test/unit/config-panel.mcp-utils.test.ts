import { describe, expect, it } from 'vitest';
import {
  applyMcpEnvUpdate,
  canToggleMcpStatus,
} from '../../views/config-panel/config-panel.mcp-utils.js';

describe('config panel MCP update helpers', () => {
  it('exposes status toggle only for adapters that persist MCP status', () => {
    expect(canToggleMcpStatus('claude-code')).toBe(true);
    expect(canToggleMcpStatus('codex')).toBe(true);
    expect(canToggleMcpStatus('copilot')).toBe(false);
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
      'claude-code',
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
      'copilot',
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
      'codex',
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
      'codex',
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
