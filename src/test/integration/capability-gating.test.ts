import * as assert from 'assert';
import { activateExtension, activateAgent, run, AgentId, cfgPath, mcpNode } from './fixtures/harness';
import { makeSandbox, Sandbox } from './fixtures/sandbox';
import { seedClaudeMarker } from './fixtures/seed';
import { withStubbedInput } from './fixtures/input';

/**
 * Capability gating — Claude Code negatives. Covers TC-39..TC-41.
 *
 * The `when`-clause context keys (ack.cap.*) aren't readable from a test, so we
 * assert the observable consequence: each capability-gated command refuses for a
 * provider whose flag is false (Claude: mcpEnvVars / mcpServerToolToggle /
 * customPromptFileInstall all false).
 */
describe('capability gating: Claude Code negatives', () => {
  let sb: Sandbox;

  before(async () => {
    await activateExtension();
  });
  beforeEach(async () => {
    sb = await makeSandbox();
    await seedClaudeMarker(sb.home);
    await activateAgent(AgentId.claudeCode);
  });
  afterEach(async () => {
    await sb.dispose();
  });

  it('TC-39: Claude has no custom-prompt file install (customPromptFileInstall:false)', async () => {
    const cap = await withStubbedInput({}, async (c) => {
      await run('ack.installCustomPromptFile');
      return c;
    });
    assert.ok(
      cap.error.some((m) => m === 'The active agent does not support installing custom prompts from a file.'),
      cap.error.join('|'),
    );
  });

  it('TC-40: Claude MCP server has no env-var support (mcpEnvVars:false)', async () => {
    const node = mcpNode({ name: 'demo-mcp', configPath: cfgPath.claude.userMcp(sb.home) });
    const cap = await withStubbedInput({}, async (c) => {
      await run('ack.addEnvVar', node);
      return c;
    });
    assert.ok(
      cap.error.some((m) => m === 'The active agent does not support MCP environment variables.'),
      cap.error.join('|'),
    );
  });

  it('TC-41: Claude has no per-tool MCP toggle (mcpServerToolToggle:false)', async () => {
    const parent = mcpNode({ name: 'demo-mcp', configPath: cfgPath.claude.userMcp(sb.home) }).tool;
    const subNode = {
      kind: 'subtool',
      subKind: 'mcp-tool',
      label: 'some-tool',
      detail: 'enabled',
      parentTool: parent,
      parent: { kind: 'tool', tool: parent },
    };
    const cap = await withStubbedInput({}, async (c) => {
      await run('ack.toggleMcpTool', subNode);
      return c;
    });
    assert.ok(
      cap.error.some((m) => m === 'The active agent does not support toggling MCP tools.'),
      cap.error.join('|'),
    );
  });
});
