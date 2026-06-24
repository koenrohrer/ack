import * as assert from 'assert';
import {
  activateExtension,
  activateAgent,
  run,
  AgentId,
  cfgPath,
  readJson,
  readToml,
  readYaml,
  exists,
  mcpNode,
  envVarNode,
  Scope,
} from './fixtures/harness';
import { makeSandbox, Sandbox } from './fixtures/sandbox';
import { seedClaudeMarker, seedCodexMarker, seedHermesMarker, seedPiMarker } from './fixtures/seed';
import { withStubbedInput, pick } from './fixtures/input';

/**
 * Add / read / toggle / remove MCP servers + env vars across providers.
 * Covers TC-33..TC-38 and the WRITE half of B-1/B-2 (correct on-disk format and
 * disable mechanism per provider: Claude `disabled:true`, Codex/Hermes
 * `enabled:false`, Pi none).
 */
describe('MCP servers: add/read/toggle/remove + env vars (matrix)', () => {
  let sb: Sandbox;

  before(async () => {
    await activateExtension();
  });
  beforeEach(async () => {
    sb = await makeSandbox();
  });
  afterEach(async () => {
    await sb.dispose();
  });

  const addStdio = (name: string, args = '-y, @modelcontextprotocol/server-everything') =>
    withStubbedInput(
      {
        inputBox: [name, 'npx', args],
        quickPick: [pick.byLabel('User (Global)'), pick.byLabelIncludes('stdio')],
        warning: ['Continue'], // defensive: only fires if npx is missing from PATH
      },
      async (cap) => {
        await run('ack.addMcpServer');
        return cap;
      },
    );

  // ---- Per-provider on-disk format (add) ----------------------------------

  it('TC-33 (Claude): stdio server -> ~/.claude.json mcpServers JSON', async () => {
    await seedClaudeMarker(sb.home);
    await activateAgent(AgentId.claudeCode);
    const cap = await addStdio('demo-mcp');
    assert.deepStrictEqual(cap.error, []);
    assert.ok(cap.info.some((m) => m === "MCP server 'demo-mcp' added."), cap.info.join('|'));
    const server = readJson(cfgPath.claude.userMcp(sb.home)).mcpServers['demo-mcp'];
    assert.strictEqual(server.command, 'npx');
    assert.deepStrictEqual(server.args, ['-y', '@modelcontextprotocol/server-everything']);
  });

  it('B-1 write (Codex): stdio server -> ~/.codex/config.toml [mcp_servers] TOML', async () => {
    await seedCodexMarker(sb.home, 'config');
    await activateAgent(AgentId.codex);
    const cap = await addStdio('demo-mcp');
    assert.deepStrictEqual(cap.error, []);
    const toml = readToml(cfgPath.codex.userConfig(sb.home));
    assert.strictEqual(toml.mcp_servers['demo-mcp'].command, 'npx');
    assert.deepStrictEqual(toml.mcp_servers['demo-mcp'].args, ['-y', '@modelcontextprotocol/server-everything']);
    assert.strictEqual(toml.model, 'gpt-5-codex', 'existing TOML keys preserved');
  });

  it('Pi: stdio server -> ~/.pi/agent/mcp.json mcpServers JSON', async () => {
    await seedPiMarker(sb.home, 'mcp');
    await activateAgent(AgentId.pi);
    const cap = await addStdio('demo-mcp');
    assert.deepStrictEqual(cap.error, []);
    const server = readJson(cfgPath.pi.userMcp(sb.home)).mcpServers['demo-mcp'];
    assert.strictEqual(server.command, 'npx');
  });

  it('Hermes: stdio server -> ~/.hermes/config.yaml mcp_servers YAML', async () => {
    await seedHermesMarker(sb.hermesHome, 'config');
    await activateAgent(AgentId.hermes);
    const cap = await addStdio('demo-mcp');
    assert.deepStrictEqual(cap.error, []);
    const yaml = readYaml(cfgPath.hermes.config(sb.hermesHome));
    assert.strictEqual(yaml.mcp_servers['demo-mcp'].command, 'npx');
  });

  // ---- HTTP transport ------------------------------------------------------

  it('TC-34 (Claude): HTTP server stores { url }', async () => {
    await seedClaudeMarker(sb.home);
    await activateAgent(AgentId.claudeCode);
    const cap = await withStubbedInput(
      {
        inputBox: ['http-mcp', 'https://mcp.example.com/mcp'], // name, then url
        quickPick: [pick.byLabel('User (Global)'), pick.byLabelIncludes('HTTP')],
      },
      async (c) => {
        await run('ack.addMcpServer');
        return c;
      },
    );
    assert.deepStrictEqual(cap.error, []);
    const server = readJson(cfgPath.claude.userMcp(sb.home)).mcpServers['http-mcp'];
    assert.strictEqual(server.url, 'https://mcp.example.com/mcp');
    assert.ok(!server.command, 'HTTP server has no command');
  });

  // ---- Validation / PATH / scope / cancel ---------------------------------

  it('TC-35 (Claude): server-name validation blocks empty + spaces', async () => {
    await seedClaudeMarker(sb.home);
    await activateAgent(AgentId.claudeCode);
    const cap = await withStubbedInput({ inputBox: [undefined] }, async (c) => {
      await run('ack.addMcpServer'); // abort at name; we only inspect validateInput
      return c;
    });
    const validate = cap.inputBoxes[0]!.validateInput!;
    assert.strictEqual(await validate(''), 'Server name is required');
    assert.strictEqual(await validate('my server'), 'Server name cannot contain spaces');
    assert.strictEqual(await validate('ok-name'), undefined);
  });

  it('TC-36 (Claude): stdio command not on PATH -> warn-and-continue / cancel', async () => {
    await seedClaudeMarker(sb.home);
    await activateAgent(AgentId.claudeCode);

    // Cancel -> nothing written.
    let cap = await withStubbedInput(
      {
        inputBox: ['ghost', 'definitely-not-a-real-binary', ''],
        quickPick: [pick.byLabel('User (Global)'), pick.byLabelIncludes('stdio')],
        warning: ['Cancel'],
      },
      async (c) => {
        await run('ack.addMcpServer');
        return c;
      },
    );
    assert.ok(cap.warning.some((m) => m.includes("not found on PATH. Continue anyway?")), cap.warning.join('|'));
    assert.ok(!exists(cfgPath.claude.userMcp(sb.home)) || !readJson(cfgPath.claude.userMcp(sb.home)).mcpServers?.ghost);

    // Continue -> written.
    cap = await withStubbedInput(
      {
        inputBox: ['ghost', 'definitely-not-a-real-binary', ''],
        quickPick: [pick.byLabel('User (Global)'), pick.byLabelIncludes('stdio')],
        warning: ['Continue'],
      },
      async (c) => {
        await run('ack.addMcpServer');
        return c;
      },
    );
    assert.ok(readJson(cfgPath.claude.userMcp(sb.home)).mcpServers.ghost, 'continue writes the server');
  });

  it('TC-37 (Claude): MCP server at Project scope -> {root}/.mcp.json', async () => {
    await seedClaudeMarker(sb.home);
    await activateAgent(AgentId.claudeCode);
    await withStubbedInput(
      {
        inputBox: ['proj-mcp', 'npx', ''],
        quickPick: [pick.byLabel('Project (Workspace)'), pick.byLabelIncludes('stdio')],
        warning: ['Continue'],
      },
      async () => {
        await run('ack.addMcpServer');
      },
    );
    assert.ok(readJson(cfgPath.claude.projectMcp(sb.workspace)).mcpServers['proj-mcp']);
    // Not written to the user file.
    assert.ok(!exists(cfgPath.claude.userMcp(sb.home)) || !readJson(cfgPath.claude.userMcp(sb.home)).mcpServers?.['proj-mcp']);
  });

  it('TC-38 (Claude): cancel at name / scope / transport / command writes nothing', async () => {
    await seedClaudeMarker(sb.home);
    await activateAgent(AgentId.claudeCode);
    const file = cfgPath.claude.userMcp(sb.home);

    const add = async () => {
      await run('ack.addMcpServer');
    };
    // Esc at name.
    await withStubbedInput({ inputBox: [undefined] }, add);
    // Esc at scope.
    await withStubbedInput({ inputBox: ['x'], quickPick: [pick.cancel()] }, add);
    // Esc at transport.
    await withStubbedInput({ inputBox: ['x'], quickPick: [pick.byLabel('User (Global)'), pick.cancel()] }, add);
    // Esc at command.
    await withStubbedInput(
      { inputBox: ['x', undefined], quickPick: [pick.byLabel('User (Global)'), pick.byLabelIncludes('stdio')] },
      add,
    );

    assert.ok(!exists(file) || Object.keys(readJson(file).mcpServers ?? {}).length === 0, 'no server written');
  });

  // ---- Toggle (disable mechanism) -----------------------------------------

  it('TC-45 (Claude): toggle MCP server sets disabled:true (not removed)', async () => {
    await seedClaudeMarker(sb.home);
    await activateAgent(AgentId.claudeCode);
    await addStdio('demo-mcp');
    const file = cfgPath.claude.userMcp(sb.home);
    await run('ack.toggleTool', mcpNode({ name: 'demo-mcp', configPath: file, scope: Scope.user, status: 'enabled' }));
    assert.strictEqual(readJson(file).mcpServers['demo-mcp'].disabled, true);
  });

  it('Codex toggle MCP server sets enabled:false', async () => {
    await seedCodexMarker(sb.home, 'config');
    await activateAgent(AgentId.codex);
    await addStdio('demo-mcp');
    const file = cfgPath.codex.userConfig(sb.home);
    await run('ack.toggleTool', mcpNode({ name: 'demo-mcp', configPath: file, scope: Scope.user, status: 'enabled' }));
    assert.strictEqual(readToml(file).mcp_servers['demo-mcp'].enabled, false);
  });

  it('Hermes toggle MCP server sets enabled:false', async () => {
    await seedHermesMarker(sb.hermesHome, 'config');
    await activateAgent(AgentId.hermes);
    await addStdio('demo-mcp');
    const file = cfgPath.hermes.config(sb.hermesHome);
    await run('ack.toggleTool', mcpNode({ name: 'demo-mcp', configPath: file, scope: Scope.user, status: 'enabled' }));
    assert.strictEqual(readYaml(file).mcp_servers['demo-mcp'].enabled, false);
  });

  it('Pi has no MCP disable mechanism (no enabled/disabled field appears)', async () => {
    await seedPiMarker(sb.home, 'mcp');
    await activateAgent(AgentId.pi);
    await addStdio('demo-mcp');
    const file = cfgPath.pi.userMcp(sb.home);
    // Toggling is unsupported for Pi MCP; whether it errors or no-ops, the file
    // must not gain a disable field.
    await withStubbedInput({}, async () => {
      await run('ack.toggleTool', mcpNode({ name: 'demo-mcp', configPath: file, scope: Scope.user, status: 'enabled' }));
    });
    const server = readJson(file).mcpServers['demo-mcp'];
    assert.ok(!('disabled' in server) && !('enabled' in server), 'no disable field for Pi');
  });

  // ---- Remove -------------------------------------------------------------

  it('Claude remove MCP server deletes the entry from the file', async () => {
    await seedClaudeMarker(sb.home);
    await activateAgent(AgentId.claudeCode);
    await addStdio('demo-mcp');
    const file = cfgPath.claude.userMcp(sb.home);
    assert.ok(readJson(file).mcpServers['demo-mcp']);
    await withStubbedInput({ warning: ['Delete'] }, async () => {
      await run('ack.deleteTool', mcpNode({ name: 'demo-mcp', configPath: file, scope: Scope.user }));
    });
    assert.ok(!readJson(file).mcpServers['demo-mcp'], 'server removed');
  });

  // ---- Env vars (B-2 write half; mcpEnvVars-capable providers) -------------

  it('B-2 write (Codex): add env var writes into [mcp_servers.NAME.env] TOML', async () => {
    await seedCodexMarker(sb.home, 'config');
    await activateAgent(AgentId.codex);
    await addStdio('demo-mcp');
    const file = cfgPath.codex.userConfig(sb.home);
    const node = mcpNode({ name: 'demo-mcp', configPath: file, scope: Scope.user });
    await withStubbedInput({ inputBox: ['API_KEY', 'secret-value'] }, async (cap) => {
      await run('ack.addEnvVar', node);
      assert.deepStrictEqual(cap.error, []);
    });
    assert.strictEqual(readToml(file).mcp_servers['demo-mcp'].env.API_KEY, 'secret-value');
  });

  it('Hermes: add env var writes into mcp_servers.NAME.env YAML', async () => {
    await seedHermesMarker(sb.hermesHome, 'config');
    await activateAgent(AgentId.hermes);
    await addStdio('demo-mcp');
    const file = cfgPath.hermes.config(sb.hermesHome);
    const node = mcpNode({ name: 'demo-mcp', configPath: file, scope: Scope.user });
    await withStubbedInput({ inputBox: ['API_KEY', 'secret-value'] }, async (cap) => {
      await run('ack.addEnvVar', node);
      assert.deepStrictEqual(cap.error, []);
    });
    assert.strictEqual(readYaml(file).mcp_servers['demo-mcp'].env.API_KEY, 'secret-value');
    void envVarNode; // used by the inline-actions suite
  });
});
