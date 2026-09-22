import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { parseMcpConfig } from '../../plugins/plugin.mcp.js';
import type { PluginDiagnostic, PluginMcpServer } from '../../types/plugin.js';

/**
 * Agent Plugins 1.0.0 §7.2 — MCP configuration, and §9.2 — expansion.
 *
 * Failure boundaries under test (§7.2.2):
 *   - whole-file problem  -> MCP disabled for the plugin, other component types
 *                            keep loading (`enabled: false`)
 *   - per-entry problem   -> that server is skipped, siblings survive
 *                            (`enabled: true`, entry absent from `servers`)
 *
 * Canonical identifiers are quoted verbatim from §5.2 / §7.2.1; they are
 * normative constants of the format, not values observed from a run.
 */

const MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';

type ParseResult = Awaited<ReturnType<typeof parseMcpConfig>>;

let pluginRoot: string;
let pluginData: string;

beforeEach(async () => {
  pluginRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-mcp-root-')));
  pluginData = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-mcp-data-')));
  await fs.mkdir(path.join(pluginRoot, 'bin'), { recursive: true });
  await fs.writeFile(path.join(pluginRoot, 'bin', 'server'), '#!/bin/sh\n', 'utf-8');
  await fs.mkdir(path.join(pluginRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(pluginData, 'cache'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(pluginRoot, { recursive: true, force: true });
  await fs.rm(pluginData, { recursive: true, force: true });
});

function options(manifestSchema: string = PLUGIN_SCHEMA) {
  return { pluginRoot, pluginData, manifestSchema };
}

function configText(servers: Record<string, unknown>, schema: string = MCP_SCHEMA): string {
  return JSON.stringify({ $schema: schema, mcpServers: servers });
}

/** Parse a config containing exactly one entry named `srv`. */
function parseOne(entry: unknown): Promise<ParseResult> {
  return parseMcpConfig(configText({ srv: entry }), options());
}

/**
 * A diagnostic identifies the component it concerns either through `subject` or
 * by naming it in the message. Asserting on identification rather than on the
 * exact English prose keeps the test from breaking on wording changes.
 */
function identifies(d: { subject?: string; message: string }, subject: string): boolean {
  return d.subject === subject || d.message.includes(subject);
}

/** The whole file was rejected: MCP disabled for the plugin, nothing loaded. */
function expectFileRejected(result: ParseResult): void {
  expect(result.enabled).toBe(false);
  expect(result.servers).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
}

/** Only the named entry was rejected: MCP stays enabled for the plugin. */
function expectEntryRejected(result: ParseResult, name = 'srv'): void {
  expect(result.enabled).toBe(true);
  expect(result.servers.map((s: PluginMcpServer) =>s.name)).not.toContain(name);
  expect(result.diagnostics.filter((d: PluginDiagnostic) =>identifies(d, name))).toHaveLength(1);
}

function expectEntryAccepted(result: ParseResult, name = 'srv') {
  expect(result.enabled).toBe(true);
  expect(result.diagnostics).toEqual([]);
  const server = result.servers.find((s: PluginMcpServer) =>s.name === name);
  expect(server).toBeDefined();
  return server!;
}

// ---------------------------------------------------------------------------
// Whole-file rules (§7.2.1 top level, §7.2.2.2)
// ---------------------------------------------------------------------------

describe('parseMcpConfig — whole-file validation', () => {
  it('accepts an empty mcpServers object', async () => {
    const result = await parseMcpConfig(configText({}), options());
    expect(result.enabled).toBe(true);
    expect(result.servers).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('disables MCP when the file is not valid JSON', async () => {
    expectFileRejected(await parseMcpConfig('{ not json', options()));
  });

  it('disables MCP when the top level is an array rather than an object', async () => {
    expectFileRejected(await parseMcpConfig('[]', options()));
  });

  it('disables MCP when $schema is absent', async () => {
    expectFileRejected(await parseMcpConfig(JSON.stringify({ mcpServers: {} }), options()));
  });

  it('disables MCP when $schema is not the canonical MCP identifier', async () => {
    expectFileRejected(
      await parseMcpConfig(configText({}, 'https://example.com/other.schema.json'), options()),
    );
  });

  it('disables MCP when $schema is the plugin manifest schema id instead of the MCP one', async () => {
    expectFileRejected(await parseMcpConfig(configText({}, PLUGIN_SCHEMA), options()));
  });

  it('disables MCP when mcpServers is absent', async () => {
    expectFileRejected(await parseMcpConfig(JSON.stringify({ $schema: MCP_SCHEMA }), options()));
  });

  it('disables MCP when mcpServers is not an object', async () => {
    expectFileRejected(
      await parseMcpConfig(JSON.stringify({ $schema: MCP_SCHEMA, mcpServers: [] }), options()),
    );
  });

  it('disables MCP when an extra top-level field is present', async () => {
    expectFileRejected(
      await parseMcpConfig(
        JSON.stringify({ $schema: MCP_SCHEMA, mcpServers: {}, timeout: 30 }),
        options(),
      ),
    );
  });

  it('disables MCP when the mcp.json version differs from the plugin.json version (§10.1)', async () => {
    const mismatched = 'https://agent-plugins.org/schemas/1.1.0/mcp.schema.json';
    const result = await parseMcpConfig(
      configText({ srv: { type: 'stdio', command: 'npx' } }, mismatched),
      options(PLUGIN_SCHEMA),
    );
    expectFileRejected(result);
  });
});

// ---------------------------------------------------------------------------
// Per-entry failure boundary (§7.2.2.3)
// ---------------------------------------------------------------------------

describe('parseMcpConfig — per-entry failure boundary', () => {
  it('keeps a valid server when a sibling entry is invalid', async () => {
    const result = await parseMcpConfig(
      configText({
        good: { type: 'stdio', command: 'npx' },
        bad: { type: 'stdio', command: 'npx', bogusField: true },
      }),
      options(),
    );

    expect(result.enabled).toBe(true);
    expect(result.servers.map((s: PluginMcpServer) =>s.name)).toEqual(['good']);
    expect(result.diagnostics.filter((d: PluginDiagnostic) =>identifies(d, 'bad'))).toHaveLength(1);
    expect(result.diagnostics.filter((d: PluginDiagnostic) =>identifies(d, 'good'))).toHaveLength(0);
  });

  it('keeps a valid server when the invalid sibling is declared first', async () => {
    const result = await parseMcpConfig(
      configText({
        bad: { type: 'not-a-transport', url: 'https://example.com/mcp' },
        good: { type: 'streamable-http', url: 'https://example.com/mcp' },
      }),
      options(),
    );

    expect(result.servers.map((s: PluginMcpServer) =>s.name)).toEqual(['good']);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('rejects only the entries referencing ${PLUGIN_DATA} when no data directory is supplied', async () => {
    // `pluginData` omitted entirely: the placeholder cannot be resolved, so
    // those entries are invalid under §7.2.2.3 while siblings survive.
    const result = await parseMcpConfig(
      configText({
        clean: { type: 'stdio', command: 'npx', args: ['${PLUGIN_ROOT}/x'] },
        'via-args': { type: 'stdio', command: 'npx', args: ['${PLUGIN_DATA}/db'] },
        'via-env': { type: 'stdio', command: 'npx', env: { STATE: '${PLUGIN_DATA}/db' } },
        'via-cwd': { type: 'stdio', command: 'npx', cwd: '${PLUGIN_DATA}/work' },
      }),
      { pluginRoot, manifestSchema: PLUGIN_SCHEMA },
    );

    expect(result.enabled).toBe(true);
    expect(result.servers.map((s: PluginMcpServer) => s.name)).toEqual(['clean']);
    expect(result.diagnostics).toHaveLength(3);
  });

  it('rejects an entry that is not an object', async () => {
    expectEntryRejected(await parseOne('npx'));
  });

  it('rejects an entry with no type field', async () => {
    expectEntryRejected(await parseOne({ command: 'npx' }));
  });

  it('rejects an entry with an unknown type value', async () => {
    expectEntryRejected(await parseOne({ type: 'websocket', url: 'wss://example.com/mcp' }));
  });
});

// ---------------------------------------------------------------------------
// stdio variant (§7.2.1)
// ---------------------------------------------------------------------------

describe('parseMcpConfig — stdio servers', () => {
  it('accepts a bare executable name and leaves it unresolved', async () => {
    const server = expectEntryAccepted(await parseOne({ type: 'stdio', command: 'npx' }));
    expect(server).toMatchObject({ name: 'srv', type: 'stdio', command: 'npx' });
  });

  it('resolves a ./ command against the plugin root', async () => {
    const server = expectEntryAccepted(await parseOne({ type: 'stdio', command: './bin/server' }));
    expect(server).toMatchObject({
      type: 'stdio',
      command: path.join(pluginRoot, 'bin', 'server'),
    });
  });

  it('rejects a shell command string rather than a single token', async () => {
    expectEntryRejected(await parseOne({ type: 'stdio', command: 'npx -y some-server' }));
  });

  it('rejects a relative path command that does not begin with ./', async () => {
    expectEntryRejected(await parseOne({ type: 'stdio', command: 'bin/server' }));
  });

  it('rejects a ../ command that escapes the plugin root', async () => {
    expectEntryRejected(await parseOne({ type: 'stdio', command: '../bin/server' }));
  });

  it('rejects an absolute path command', async () => {
    expectEntryRejected(await parseOne({ type: 'stdio', command: '/usr/bin/node' }));
  });

  it('rejects an empty command', async () => {
    expectEntryRejected(await parseOne({ type: 'stdio', command: '' }));
  });

  it('rejects a missing command', async () => {
    expectEntryRejected(await parseOne({ type: 'stdio' }));
  });

  it('rejects a non-string command', async () => {
    expectEntryRejected(await parseOne({ type: 'stdio', command: 42 }));
  });

  it('does not expand placeholders in command — ${PLUGIN_ROOT} makes the token invalid', async () => {
    // §9.2: expansion does not apply to `command`, so the literal token is
    // neither a bare name nor a ./ path and the entry is invalid.
    expectEntryRejected(await parseOne({ type: 'stdio', command: '${PLUGIN_ROOT}/bin/server' }));
  });

  it('rejects a field that belongs to the remote variant', async () => {
    expectEntryRejected(
      await parseOne({ type: 'stdio', command: 'npx', url: 'https://example.com/mcp' }),
    );
  });

  it('rejects an unknown field on a stdio entry', async () => {
    expectEntryRejected(await parseOne({ type: 'stdio', command: 'npx', timeout: 30 }));
  });

  it('rejects a non-array args', async () => {
    expectEntryRejected(await parseOne({ type: 'stdio', command: 'npx', args: '--flag' }));
  });

  it('rejects args containing a non-string element', async () => {
    expectEntryRejected(await parseOne({ type: 'stdio', command: 'npx', args: ['--port', 8080] }));
  });

  it('rejects a non-string env value', async () => {
    expectEntryRejected(await parseOne({ type: 'stdio', command: 'npx', env: { DEBUG: true } }));
  });

  it('rejects an entry whose env declares the reserved key PLUGIN_ROOT (§9.2)', async () => {
    expectEntryRejected(
      await parseOne({ type: 'stdio', command: 'npx', env: { PLUGIN_ROOT: '/somewhere' } }),
    );
  });

  it('rejects an entry whose env declares the reserved key PLUGIN_DATA (§9.2)', async () => {
    expectEntryRejected(
      await parseOne({ type: 'stdio', command: 'npx', env: { PLUGIN_DATA: '/somewhere' } }),
    );
  });

  it('accepts env keys that merely resemble the reserved names', async () => {
    const server = expectEntryAccepted(
      await parseOne({
        type: 'stdio',
        command: 'npx',
        env: { MY_PLUGIN_ROOT: '/a', PLUGIN_ROOT_DIR: '/b', PLUGIN_DATABASE: '/c' },
      }),
    );
    expect(server).toMatchObject({
      env: expect.objectContaining({
        MY_PLUGIN_ROOT: '/a',
        PLUGIN_ROOT_DIR: '/b',
        PLUGIN_DATABASE: '/c',
      }),
    });
  });
});

// ---------------------------------------------------------------------------
// stdio cwd (§7.2.1)
// ---------------------------------------------------------------------------

describe('parseMcpConfig — stdio cwd', () => {
  it('defaults an omitted cwd to the filesystem-resolved plugin root', async () => {
    const server = expectEntryAccepted(await parseOne({ type: 'stdio', command: 'npx' }));
    expect(server).toMatchObject({ cwd: pluginRoot });
  });

  it('resolves a ./ cwd against the plugin root', async () => {
    const server = expectEntryAccepted(
      await parseOne({ type: 'stdio', command: 'npx', cwd: './data' }),
    );
    expect(server).toMatchObject({ cwd: path.join(pluginRoot, 'data') });
  });

  it('resolves a bare ${PLUGIN_ROOT} cwd to the plugin root', async () => {
    const server = expectEntryAccepted(
      await parseOne({ type: 'stdio', command: 'npx', cwd: '${PLUGIN_ROOT}' }),
    );
    expect(server).toMatchObject({ cwd: pluginRoot });
  });

  it('resolves a ${PLUGIN_ROOT}/… cwd beneath the plugin root', async () => {
    const server = expectEntryAccepted(
      await parseOne({ type: 'stdio', command: 'npx', cwd: '${PLUGIN_ROOT}/data' }),
    );
    expect(server).toMatchObject({ cwd: path.join(pluginRoot, 'data') });
  });

  it('resolves a bare ${PLUGIN_DATA} cwd to the plugin data directory', async () => {
    const server = expectEntryAccepted(
      await parseOne({ type: 'stdio', command: 'npx', cwd: '${PLUGIN_DATA}' }),
    );
    expect(server).toMatchObject({ cwd: pluginData });
  });

  it('resolves a ${PLUGIN_DATA}/… cwd beneath the plugin data directory', async () => {
    const server = expectEntryAccepted(
      await parseOne({ type: 'stdio', command: 'npx', cwd: '${PLUGIN_DATA}/cache' }),
    );
    expect(server).toMatchObject({ cwd: path.join(pluginData, 'cache') });
  });

  it('rejects a bare relative cwd', async () => {
    // §4.1 example: `cwd: "data"` is not a plugin-relative path.
    expectEntryRejected(await parseOne({ type: 'stdio', command: 'npx', cwd: 'data' }));
  });

  it('rejects an absolute cwd', async () => {
    expectEntryRejected(await parseOne({ type: 'stdio', command: 'npx', cwd: pluginRoot }));
  });

  it('rejects a ../ cwd', async () => {
    expectEntryRejected(await parseOne({ type: 'stdio', command: 'npx', cwd: '../elsewhere' }));
  });

  it('rejects a ${PLUGIN_ROOT} cwd that escapes the plugin root after resolution', async () => {
    // '${PLUGIN_ROOT}/..' resolves to the parent directory, which exists — so a
    // rejection here is about containment, not about a missing directory.
    expectEntryRejected(await parseOne({ type: 'stdio', command: 'npx', cwd: '${PLUGIN_ROOT}/..' }));
  });

  it('rejects a ${PLUGIN_DATA} cwd that escapes the plugin data directory after resolution', async () => {
    expectEntryRejected(await parseOne({ type: 'stdio', command: 'npx', cwd: '${PLUGIN_DATA}/..' }));
  });

  it('rejects a ${PLUGIN_ROOT}-prefixed cwd that is not followed by a separator', async () => {
    // "${PLUGIN_ROOT}x" is none of the three permitted forms.
    expectEntryRejected(
      await parseOne({ type: 'stdio', command: 'npx', cwd: '${PLUGIN_ROOT}x' }),
    );
  });

  it('rejects a cwd anchored on an unrecognized placeholder', async () => {
    expectEntryRejected(await parseOne({ type: 'stdio', command: 'npx', cwd: '${HOME}/work' }));
  });
});

// ---------------------------------------------------------------------------
// Placeholder expansion inside stdio entries (§9.2)
// ---------------------------------------------------------------------------

describe('parseMcpConfig — placeholder expansion', () => {
  it('expands ${PLUGIN_ROOT} and ${PLUGIN_DATA} in args', async () => {
    const server = expectEntryAccepted(
      await parseOne({
        type: 'stdio',
        command: 'npx',
        args: ['--config', '${PLUGIN_ROOT}/config.json', '--state', '${PLUGIN_DATA}/db'],
      }),
    );
    expect(server).toMatchObject({
      args: ['--config', `${pluginRoot}/config.json`, '--state', `${pluginData}/db`],
    });
  });

  it('expands placeholders in env values but not in env keys', async () => {
    const server = expectEntryAccepted(
      await parseOne({
        type: 'stdio',
        command: 'npx',
        env: { CONFIG: '${PLUGIN_ROOT}/config.json', '${PLUGIN_ROOT}': 'literal-key' },
      }),
    );
    expect(server).toMatchObject({
      env: expect.objectContaining({
        CONFIG: `${pluginRoot}/config.json`,
        '${PLUGIN_ROOT}': 'literal-key',
      }),
    });
  });

  it('leaves unrecognized placeholder-like text in args literal', async () => {
    const server = expectEntryAccepted(
      await parseOne({ type: 'stdio', command: 'npx', args: ['${HOME}/x', '$PLUGIN_ROOT'] }),
    );
    expect(server).toMatchObject({ args: ['${HOME}/x', '$PLUGIN_ROOT'] });
  });
});

// ---------------------------------------------------------------------------
// streamable-http / sse variants (§7.2.1)
// ---------------------------------------------------------------------------

describe('parseMcpConfig — remote servers', () => {
  it('accepts an https streamable-http endpoint', async () => {
    const server = expectEntryAccepted(
      await parseOne({ type: 'streamable-http', url: 'https://deploy.example.com/mcp' }),
    );
    expect(server).toMatchObject({
      name: 'srv',
      type: 'streamable-http',
      url: 'https://deploy.example.com/mcp',
    });
  });

  it('accepts an https sse endpoint', async () => {
    const server = expectEntryAccepted(
      await parseOne({ type: 'sse', url: 'https://legacy.example.com/sse' }),
    );
    expect(server).toMatchObject({ type: 'sse', url: 'https://legacy.example.com/sse' });
  });

  it('rejects http on a non-loopback host', async () => {
    expectEntryRejected(await parseOne({ type: 'streamable-http', url: 'http://example.com/mcp' }));
  });

  it('accepts http on exactly localhost', async () => {
    const server = expectEntryAccepted(
      await parseOne({ type: 'streamable-http', url: 'http://localhost:3000/mcp' }),
    );
    expect(server).toMatchObject({ url: 'http://localhost:3000/mcp' });
  });

  it('accepts http on the IPv4 loopback literal', async () => {
    const server = expectEntryAccepted(
      await parseOne({ type: 'streamable-http', url: 'http://127.0.0.1:3000/mcp' }),
    );
    expect(server).toMatchObject({ url: 'http://127.0.0.1:3000/mcp' });
  });

  it('accepts http anywhere in the 127.0.0.0/8 loopback range', async () => {
    const server = expectEntryAccepted(
      await parseOne({ type: 'streamable-http', url: 'http://127.1.2.3:8080/mcp' }),
    );
    expect(server).toMatchObject({ url: 'http://127.1.2.3:8080/mcp' });
  });

  it('accepts http on the IPv6 loopback literal', async () => {
    const server = expectEntryAccepted(
      await parseOne({ type: 'streamable-http', url: 'http://[::1]:3000/mcp' }),
    );
    expect(server).toMatchObject({ url: 'http://[::1]:3000/mcp' });
  });

  it('rejects http on a host that merely ends in localhost', async () => {
    expectEntryRejected(
      await parseOne({ type: 'streamable-http', url: 'http://localhost.example.com/mcp' }),
    );
  });

  it('rejects http on a non-loopback IPv4 literal', async () => {
    expectEntryRejected(await parseOne({ type: 'streamable-http', url: 'http://10.0.0.5/mcp' }));
  });

  it('rejects a url containing user information', async () => {
    expectEntryRejected(
      await parseOne({ type: 'streamable-http', url: 'https://user:pass@example.com/mcp' }),
    );
  });

  it('rejects a url containing a username with no password', async () => {
    expectEntryRejected(
      await parseOne({ type: 'streamable-http', url: 'https://user@example.com/mcp' }),
    );
  });

  it('rejects a url containing a fragment', async () => {
    expectEntryRejected(
      await parseOne({ type: 'streamable-http', url: 'https://example.com/mcp#section' }),
    );
  });

  it('rejects a url with an empty fragment', async () => {
    expectEntryRejected(
      await parseOne({ type: 'streamable-http', url: 'https://example.com/mcp#' }),
    );
  });

  it('rejects a relative url', async () => {
    expectEntryRejected(await parseOne({ type: 'streamable-http', url: '/mcp' }));
  });

  it('rejects a non-http scheme', async () => {
    expectEntryRejected(await parseOne({ type: 'streamable-http', url: 'ftp://example.com/mcp' }));
  });

  it('rejects a ws scheme', async () => {
    expectEntryRejected(await parseOne({ type: 'streamable-http', url: 'wss://example.com/mcp' }));
  });

  it('rejects a missing url', async () => {
    expectEntryRejected(await parseOne({ type: 'streamable-http' }));
  });

  it('rejects a field that belongs to the stdio variant', async () => {
    expectEntryRejected(
      await parseOne({ type: 'streamable-http', url: 'https://example.com/mcp', command: 'npx' }),
    );
  });

  it('rejects an unknown field on a remote entry', async () => {
    expectEntryRejected(
      await parseOne({ type: 'streamable-http', url: 'https://example.com/mcp', timeout: 30 }),
    );
  });

  it('accepts distinct header names', async () => {
    const server = expectEntryAccepted(
      await parseOne({
        type: 'streamable-http',
        url: 'https://example.com/mcp',
        headers: { 'X-Tenant': 'public', Accept: 'application/json' },
      }),
    );
    expect(server).toMatchObject({
      headers: { 'X-Tenant': 'public', Accept: 'application/json' },
    });
  });

  it('rejects an entry whose headers repeat one name under different casing', async () => {
    expectEntryRejected(
      await parseOne({
        type: 'streamable-http',
        url: 'https://example.com/mcp',
        headers: { 'X-Tenant': 'public', 'x-tenant': 'other' },
      }),
    );
  });

  it('rejects a non-string header value', async () => {
    expectEntryRejected(
      await parseOne({
        type: 'streamable-http',
        url: 'https://example.com/mcp',
        headers: { 'X-Retries': 3 },
      }),
    );
  });

  it('does not expand placeholders in url or header values', async () => {
    const server = expectEntryAccepted(
      await parseOne({
        type: 'streamable-http',
        url: 'https://example.com/mcp?root=${PLUGIN_ROOT}',
        headers: { 'X-Root': '${PLUGIN_ROOT}' },
      }),
    );
    expect(server).toMatchObject({
      url: 'https://example.com/mcp?root=${PLUGIN_ROOT}',
      headers: { 'X-Root': '${PLUGIN_ROOT}' },
    });
  });
});
