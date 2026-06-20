import { describe, it, expect } from 'vitest';
import {
  decideStartupAgent,
  agentDetectedKey,
} from '../../services/agent-reconcile.utils.js';

// ---------------------------------------------------------------------------
// decideStartupAgent
// ---------------------------------------------------------------------------

describe('decideStartupAgent', () => {
  it('activates the persisted agent when it is still detected', () => {
    expect(
      decideStartupAgent({ persistedId: 'codex', detectedIds: ['claude-code', 'codex'] }),
    ).toEqual({ kind: 'activate', id: 'codex' });
  });

  it('activates the lone other agent when the persisted one is gone', () => {
    expect(
      decideStartupAgent({ persistedId: 'codex', detectedIds: ['claude-code'] }),
    ).toEqual({ kind: 'activate', id: 'claude-code' });
  });

  it('routes to choose when the persisted one is gone and 2+ others remain', () => {
    expect(
      decideStartupAgent({ persistedId: 'codex', detectedIds: ['claude-code', 'copilot'] }),
    ).toEqual({ kind: 'choose' });
  });

  it('activates the single detected agent when there is no history', () => {
    expect(
      decideStartupAgent({ persistedId: undefined, detectedIds: ['claude-code'] }),
    ).toEqual({ kind: 'activate', id: 'claude-code' });
  });

  it('routes to choose when 2+ detected and no history', () => {
    expect(
      decideStartupAgent({ persistedId: undefined, detectedIds: ['claude-code', 'codex'] }),
    ).toEqual({ kind: 'choose' });
  });

  it('returns none when nothing is detected', () => {
    expect(
      decideStartupAgent({ persistedId: 'codex', detectedIds: [] }),
    ).toEqual({ kind: 'none' });
  });
});

// ---------------------------------------------------------------------------
// agentDetectedKey
// ---------------------------------------------------------------------------

describe('agentDetectedKey', () => {
  it('strips hyphens from the key leaf but leaves the id semantics intact', () => {
    expect(agentDetectedKey('claude-code')).toBe('ack.agentDetected.claudecode');
  });

  it('passes hyphen-free ids through unchanged', () => {
    expect(agentDetectedKey('codex')).toBe('ack.agentDetected.codex');
    expect(agentDetectedKey('copilot')).toBe('ack.agentDetected.copilot');
  });
});
