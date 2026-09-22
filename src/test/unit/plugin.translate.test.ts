import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { installedServerName, toNativeMcpServer } from '../../plugins/plugin.translate.js';
import type { TranslateResult } from '../../plugins/plugin.translate.js';
import type { McpTransportSupport, PluginMcpTransport } from '../../types/provider-mcp.js';
import type { PluginMcpServer } from '../../types/plugin.js';
import { extractToolTypeFromKey } from '../../utils/tool-key.utils.js';
import { ToolType } from '../../types/enums.js';
import { CodexProvider } from '../../providers/codex/codex.provider.js';
import { SchemaService } from '../../services/schema.service.js';
import { createMockFileIO } from './helpers/mock-fileio.js';

/**
 * Agent Plugins 1.0.0 §7.2.1 / §7.2.2.4 / §9.1 / §9.2 — translating one already
 * resolved `PluginMcpServer` into the native object handed to
 * `provider.installMcpServer(scope, name, serverConfig)`.
 *
 * The one thing this module must NOT do is expand anything. Phase 1's
 * `parseMcpConfig` (`plugin.mcp.ts`, `buildStdioServer`) has already expanded
 * `${PLUGIN_ROOT}` / `${PLUGIN_DATA}` in `args`, `env` values and `cwd`, already
 * resolved a `./` command against the plugin root, already left a bare command
 * alone, and already made `cwd` absolute. `vars` exists here for exactly one
 * purpose: injecting the two reserved names into the emitted `env` per §9.1.
 *
 * Transport encoding is driven by the provider's `McpTransportSupport`
 * descriptor (phase 2 addendum §B1) — never by a provider id.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Absolute paths of ACK's two owned trees. Plain strings: the module under test
 * is pure, so nothing here needs to exist on disk.
 */
const VARS = {
  pluginRoot: '/store/plugins/acme.tools',
  pluginData: '/store/plugin-data/acme.tools',
};

/** The env every stdio translation must end up carrying (§9.1). */
const INJECTED_ENV = {
  PLUGIN_ROOT: VARS.pluginRoot,
  PLUGIN_DATA: VARS.pluginData,
};

/**
 * The five per-provider descriptors, quoted verbatim from addendum §B1. They
 * are the contract's own table, not values observed from a run.
 */
const SUPPORT: Record<string, McpTransportSupport> = {
  'claude-code': { field: 'type', native: { stdio: 'stdio', 'streamable-http': 'http', sse: 'sse' } },
  copilot: { field: 'type', native: { stdio: 'stdio', 'streamable-http': 'http', sse: 'sse' } },
  codex: { field: undefined, native: { stdio: null, 'streamable-http': null } },
  pi: { field: 'transport', native: { stdio: 'stdio', 'streamable-http': 'streamable-http', sse: 'sse' } },
  hermes: { field: 'transport', native: { stdio: 'stdio', 'streamable-http': 'streamable-http', sse: 'sse' } },
};

function stdioServer(overrides: Partial<Extract<PluginMcpServer, { type: 'stdio' }>> = {}) {
  return { name: 'srv', type: 'stdio' as const, command: 'npx', ...overrides };
}

function remoteServer(
  type: 'streamable-http' | 'sse',
  overrides: Partial<Extract<PluginMcpServer, { type: 'streamable-http' | 'sse' }>> = {},
) {
  return { name: 'srv', type, url: 'https://deploy.example.com/mcp', ...overrides };
}

/** The translated config, or a failure naming the reason the skip was wrong. */
function expectTranslated(result: TranslateResult): Record<string, unknown> {
  if (!result.ok) {
    throw new Error(`expected a translated config, got a skip: ${result.reason}`);
  }
  return result.config;
}

/** The skip reason, or a failure showing the config that should not have existed. */
function expectSkipped(result: TranslateResult): string {
  if (result.ok) {
    throw new Error(`expected the server to be skipped, got: ${JSON.stringify(result.config)}`);
  }
  return result.reason;
}

// ---------------------------------------------------------------------------
// §9.1 — subprocess environment injection
// ---------------------------------------------------------------------------

describe('toNativeMcpServer — §9.1 env injection', () => {
  it('injects PLUGIN_ROOT and PLUGIN_DATA with the values from vars', () => {
    const config = expectTranslated(
      toNativeMcpServer(stdioServer({ env: { CONFIG: '/store/plugins/acme.tools/config.json' } }), VARS, SUPPORT['claude-code']),
    );
    expect(config.env).toStrictEqual({
      CONFIG: '/store/plugins/acme.tools/config.json',
      ...INJECTED_ENV,
    });
  });

  it("writes the injected names after the plugin's own env (§9.1 ordering)", () => {
    // §9.1: the plugin's env overlays the base environment, and the client
    // "MUST then set" the two reserved names. Writing them last makes that hold
    // by construction. The order of the pair relative to each other is not
    // specified, so only their position after the plugin's own keys is pinned.
    const config = expectTranslated(
      toNativeMcpServer(
        stdioServer({ env: { CONFIG: '/store/plugins/acme.tools/config.json', DATA_DIR: '/store/plugin-data/acme.tools/db' } }),
        VARS,
        SUPPORT['claude-code'],
      ),
    );
    const keys = Object.keys(config.env as Record<string, string>);
    expect(keys.slice(0, 2)).toEqual(['CONFIG', 'DATA_DIR']);
    expect(keys.slice(2).sort()).toEqual(['PLUGIN_DATA', 'PLUGIN_ROOT']);
  });

  it('gives a server that declares no env an env holding exactly the two injected names', () => {
    const config = expectTranslated(toNativeMcpServer(stdioServer(), VARS, SUPPORT['claude-code']));
    expect(config.env).toStrictEqual(INJECTED_ENV);
  });

  it("replaces a same-named env entry with the client's value (§9.1)", () => {
    // Phase 1 rejects an entry declaring a reserved name (§9.2), so this object
    // is constructed directly rather than parsed. §9.1 still governs: the
    // client's values replace same-named entries, so a value that reached here
    // by any other route must not survive.
    const config = expectTranslated(
      toNativeMcpServer(stdioServer({ env: { PLUGIN_ROOT: '/attacker' } }), VARS, SUPPORT['claude-code']),
    );
    const env = config.env as Record<string, string>;
    expect(env.PLUGIN_ROOT).toBe(VARS.pluginRoot);
    expect(env.PLUGIN_DATA).toBe(VARS.pluginData);
    expect(Object.keys(env).sort()).toEqual(['PLUGIN_DATA', 'PLUGIN_ROOT']);
  });

  it('adds no env to a streamable-http server — §9.1 scopes the injection to launched subprocesses', () => {
    const config = expectTranslated(
      toNativeMcpServer(remoteServer('streamable-http'), VARS, SUPPORT['claude-code']),
    );
    expect(Object.keys(config)).not.toContain('env');
    expect(config.url).toBe('https://deploy.example.com/mcp');
  });

  it('adds no env to an sse server — §9.1 scopes the injection to launched subprocesses', () => {
    const config = expectTranslated(toNativeMcpServer(remoteServer('sse'), VARS, SUPPORT.pi));
    expect(Object.keys(config)).not.toContain('env');
    expect(config.url).toBe('https://deploy.example.com/mcp');
  });
});

// ---------------------------------------------------------------------------
// §9.2 — the input is already expanded; this module expands nothing
// ---------------------------------------------------------------------------

describe('toNativeMcpServer — no re-expansion (§9.2)', () => {
  it('leaves a literal ${PLUGIN_ROOT} in args untouched', () => {
    // §9.2 expansion is a single non-recursive pass, already performed by
    // `parseMcpConfig`. A literal that survived it (e.g. text introduced by a
    // replacement, or `${PLUGIN_ROOT}` inside the plugin data path itself) is
    // data, not a placeholder. A translator that expands again corrupts it.
    const config = expectTranslated(
      toNativeMcpServer(
        stdioServer({ args: ['--label', '${PLUGIN_ROOT}', '--path', '/store/plugins/acme.tools/x'] }),
        VARS,
        SUPPORT['claude-code'],
      ),
    );
    expect(config.args).toStrictEqual(['--label', '${PLUGIN_ROOT}', '--path', '/store/plugins/acme.tools/x']);
  });

  it('leaves a literal ${PLUGIN_DATA} in an env value untouched', () => {
    const config = expectTranslated(
      toNativeMcpServer(stdioServer({ env: { TEMPLATE: 'use ${PLUGIN_DATA} here' } }), VARS, SUPPORT['claude-code']),
    );
    expect((config.env as Record<string, string>).TEMPLATE).toBe('use ${PLUGIN_DATA} here');
  });

  it('leaves a literal ${PLUGIN_ROOT} in a header value untouched', () => {
    const config = expectTranslated(
      toNativeMcpServer(
        remoteServer('streamable-http', { headers: { 'X-Root': '${PLUGIN_ROOT}' } }),
        VARS,
        SUPPORT['claude-code'],
      ),
    );
    expect(config.headers).toStrictEqual({ 'X-Root': '${PLUGIN_ROOT}' });
  });
});

// ---------------------------------------------------------------------------
// §7.2.1 / §7.2.2.4 — transport encoding from the §B1 descriptor
// ---------------------------------------------------------------------------

describe('toNativeMcpServer — transport encoding (addendum §B1)', () => {
  it("writes the descriptor's native value, not the portable name, for streamable-http", () => {
    const config = expectTranslated(
      toNativeMcpServer(remoteServer('streamable-http'), VARS, SUPPORT['claude-code']),
    );
    expect(config.type).toBe('http');
    expect(Object.keys(config)).not.toContain('transport');
  });

  it("writes the descriptor's own field name when it is `transport`", () => {
    const config = expectTranslated(toNativeMcpServer(remoteServer('streamable-http'), VARS, SUPPORT.pi));
    expect(config.transport).toBe('streamable-http');
    expect(Object.keys(config)).not.toContain('type');
  });

  it('writes no transport key at all for a stdio server when the descriptor has no field (codex)', () => {
    const config = expectTranslated(toNativeMcpServer(stdioServer(), VARS, SUPPORT.codex));
    expect(Object.keys(config).sort()).toEqual(['command', 'env']);
  });

  it('writes no transport key at all for a streamable-http server when the descriptor has no field (codex)', () => {
    const config = expectTranslated(toNativeMcpServer(remoteServer('streamable-http'), VARS, SUPPORT.codex));
    expect(Object.keys(config).sort()).toEqual(['url']);
  });

  it('skips a server whose transport is absent from the descriptor, naming the transport (§7.2.2.4)', () => {
    const reason = expectSkipped(toNativeMcpServer(remoteServer('sse'), VARS, SUPPORT.codex));
    expect(reason).toContain('sse');
  });

  const stdioEncodings: Array<[string, Record<string, unknown>]> = [
    ['claude-code', { type: 'stdio' }],
    ['copilot', { type: 'stdio' }],
    ['codex', {}],
    ['pi', { transport: 'stdio' }],
    ['hermes', { transport: 'stdio' }],
  ];

  it.each(stdioEncodings)('encodes a stdio transport for the %s descriptor', (id, transportFields) => {
    const config = expectTranslated(toNativeMcpServer(stdioServer(), VARS, SUPPORT[id]));
    expect(config).toStrictEqual({ command: 'npx', env: INJECTED_ENV, ...transportFields });
  });

  const remoteEncodings: Array<[string, PluginMcpTransport, Record<string, unknown>]> = [
    ['claude-code', 'streamable-http', { type: 'http' }],
    ['claude-code', 'sse', { type: 'sse' }],
    ['copilot', 'streamable-http', { type: 'http' }],
    ['copilot', 'sse', { type: 'sse' }],
    ['codex', 'streamable-http', {}],
    ['pi', 'streamable-http', { transport: 'streamable-http' }],
    ['pi', 'sse', { transport: 'sse' }],
    ['hermes', 'streamable-http', { transport: 'streamable-http' }],
    ['hermes', 'sse', { transport: 'sse' }],
  ];

  it.each(remoteEncodings)('encodes %s + %s from the descriptor', (id, transport, transportFields) => {
    const config = expectTranslated(
      toNativeMcpServer(remoteServer(transport as 'streamable-http' | 'sse'), VARS, SUPPORT[id]),
    );
    expect(config).toStrictEqual({ url: 'https://deploy.example.com/mcp', ...transportFields });
  });
});

// ---------------------------------------------------------------------------
// §7.2.1 — resolved fields pass through verbatim
// ---------------------------------------------------------------------------

describe('toNativeMcpServer — pass-through of already-resolved fields (§7.2.1)', () => {
  it('emits an absolute command unchanged', () => {
    // `resolveCommand` already turned a `./bin/validator` into this absolute
    // path against the plugin root; re-resolving would be a second resolution.
    const command = '/store/plugins/acme.tools/bin/validator';
    const config = expectTranslated(toNativeMcpServer(stdioServer({ command }), VARS, SUPPORT['claude-code']));
    expect(config.command).toBe(command);
  });

  it('emits a bare command unchanged and does not make it absolute', () => {
    // §7.2.1: a bare name MUST be resolved by the platform executable search,
    // so it has to reach the agent's config still bare.
    const config = expectTranslated(toNativeMcpServer(stdioServer({ command: 'npx' }), VARS, SUPPORT['claude-code']));
    expect(config.command).toBe('npx');
  });

  it('emits cwd exactly as given', () => {
    // Every provider MCP schema is `.passthrough()`, so emitting `cwd` keeps
    // the §7.2.1 working-directory guarantee even though no parser reads it.
    const cwd = '/store/plugin-data/acme.tools/work';
    const config = expectTranslated(toNativeMcpServer(stdioServer({ cwd }), VARS, SUPPORT['claude-code']));
    expect(config.cwd).toBe(cwd);
  });

  it('emits url and headers for a remote server', () => {
    const config = expectTranslated(
      toNativeMcpServer(
        remoteServer('streamable-http', { headers: { 'X-Tenant': 'public-tenant', Accept: 'application/json' } }),
        VARS,
        SUPPORT['claude-code'],
      ),
    );
    expect(config.url).toBe('https://deploy.example.com/mcp');
    expect(config.headers).toStrictEqual({ 'X-Tenant': 'public-tenant', Accept: 'application/json' });
  });
});

// ---------------------------------------------------------------------------
// The headers key comes from the descriptor too
// ---------------------------------------------------------------------------

describe('toNativeMcpServer — headers key from the descriptor', () => {
  const HEADERS = { 'X-Tenant': 'public-tenant' };

  it('writes headers under the key the descriptor names', () => {
    const support: McpTransportSupport = {
      field: undefined,
      native: { stdio: null, 'streamable-http': null },
      headersField: 'http_headers',
    };
    const config = expectTranslated(
      toNativeMcpServer(remoteServer('streamable-http', { headers: HEADERS }), VARS, support),
    );

    expect(config.http_headers).toStrictEqual(HEADERS);
    expect(Object.keys(config)).not.toContain('headers');
  });

  it("writes Codex's http_headers, read off the Codex provider itself", () => {
    const support = new CodexProvider(createMockFileIO(), new SchemaService()).getMcpTransportSupport();
    const config = expectTranslated(
      toNativeMcpServer(remoteServer('streamable-http', { headers: HEADERS }), VARS, support),
    );

    expect(config).toStrictEqual({ url: 'https://deploy.example.com/mcp', http_headers: HEADERS });
  });
});

// ---------------------------------------------------------------------------
// Copies, not aliases
// ---------------------------------------------------------------------------

describe('toNativeMcpServer — the emitted config shares no mutable state with its input', () => {
  it('copies args rather than aliasing them', () => {
    const server = stdioServer({ args: ['--flag'] });
    const config = expectTranslated(toNativeMcpServer(server, VARS, SUPPORT['claude-code']));

    (config.args as string[]).push('added-to-config');
    expect(server.args).toStrictEqual(['--flag']);

    server.args!.push('added-to-server');
    expect(config.args).toStrictEqual(['--flag', 'added-to-config']);
  });

  it('copies env rather than aliasing it', () => {
    const server = stdioServer({ env: { CONFIG: 'a' } });
    const config = expectTranslated(toNativeMcpServer(server, VARS, SUPPORT['claude-code']));

    (config.env as Record<string, string>).CONFIG = 'b';
    expect(server.env).toStrictEqual({ CONFIG: 'a' });

    server.env!.CONFIG = 'c';
    expect((config.env as Record<string, string>).CONFIG).toBe('b');
  });

  it('copies headers rather than aliasing them', () => {
    const server = remoteServer('streamable-http', { headers: { 'X-Tenant': 'public' } });
    const config = expectTranslated(toNativeMcpServer(server, VARS, SUPPORT['claude-code']));

    (config.headers as Record<string, string>)['X-Tenant'] = 'mutated';
    expect(server.headers).toStrictEqual({ 'X-Tenant': 'public' });

    server.headers!['X-Tenant'] = 'mutated-later';
    expect((config.headers as Record<string, string>)['X-Tenant']).toBe('mutated');
  });
});

// ---------------------------------------------------------------------------
// No absent-field noise
// ---------------------------------------------------------------------------

describe('toNativeMcpServer — emits only the fields the server has', () => {
  it('emits no args, headers, url or cwd for a minimal stdio server', () => {
    const config = expectTranslated(toNativeMcpServer(stdioServer(), VARS, SUPPORT['claude-code']));
    // Exact key set: `name` is passed to `installMcpServer` separately, and an
    // absent optional field must not appear as an explicit undefined.
    expect(Object.keys(config).sort()).toEqual(['command', 'env', 'type']);
    expect(config).toStrictEqual({ type: 'stdio', command: 'npx', env: INJECTED_ENV });
  });

  it('emits no command, args, env or headers for a minimal remote server', () => {
    const config = expectTranslated(toNativeMcpServer(remoteServer('sse'), VARS, SUPPORT['claude-code']));
    expect(Object.keys(config).sort()).toEqual(['type', 'url']);
    expect(config).toStrictEqual({ type: 'sse', url: 'https://deploy.example.com/mcp' });
  });
});

// ---------------------------------------------------------------------------
// Installed server naming (addendum §A3)
// ---------------------------------------------------------------------------

describe('installedServerName', () => {
  it('namespaces the server under its plugin as <plugin>__<server> (§A3)', () => {
    expect(installedServerName('acme.tools', 'github')).toBe('acme.tools__github');
  });

  it('produces a name that canonicalKey can still classify — it introduces no ":"', () => {
    // `canonicalKey` builds `${type}:${name}` and `extractToolTypeFromKey`
    // splits on the FIRST ':'. A separator containing ':' would still classify,
    // but §5.5 forbids ':' in a plugin name and '__' introduces none, so the
    // namespaced name must round-trip through the key format untouched.
    const name = installedServerName('acme.tools', 'github');
    const key = `${ToolType.McpServer}:${name}`;

    expect(name).not.toContain(':');
    expect(key).toBe('mcp_server:acme.tools__github');
    expect(extractToolTypeFromKey(key)).toBe(ToolType.McpServer);
  });
});

// ---------------------------------------------------------------------------
// Purity — the module stays unit-testable
// ---------------------------------------------------------------------------

describe('plugin.translate.ts purity', () => {
  const modulePath = fileURLToPath(new URL('../../plugins/plugin.translate.ts', import.meta.url));

  it('imports neither vscode nor any filesystem module', async () => {
    const source = await fs.readFile(modulePath, 'utf-8');
    expect(source).not.toMatch(/from\s+['"]vscode['"]/);
    expect(source).not.toMatch(/require\(\s*['"]vscode['"]\s*\)/);
    expect(source).not.toMatch(/from\s+['"](?:node:)?fs(?:\/promises)?['"]/);
    expect(source).not.toMatch(/require\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\)/);
  });
});
