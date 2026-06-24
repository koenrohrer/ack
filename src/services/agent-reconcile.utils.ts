/**
 * Pure startup-reconciliation logic, split out so it is unit-testable without
 * vscode. The extension wires the decision to switchAgent / context keys.
 */

/** The outcome of reconciling persisted + detected agents on startup. */
export type ReconcileDecision =
  | { kind: 'activate'; id: string }
  | { kind: 'choose' }
  | { kind: 'none' };

/**
 * Decide which agent (if any) to activate on startup.
 *
 * Precedence:
 *  (a) the persisted/last-used agent, if still detected -> activate it;
 *  (b) else exactly one detected agent -> activate it;
 *  (c) else two or more detected and no usable history -> let the user choose
 *      (do NOT auto-pick);
 *  (d) else nothing detected -> none.
 */
export function decideStartupAgent(input: {
  persistedId: string | undefined;
  detectedIds: readonly string[];
}): ReconcileDecision {
  const { persistedId, detectedIds } = input;

  if (persistedId && detectedIds.includes(persistedId)) {
    return { kind: 'activate', id: persistedId };
  }
  if (detectedIds.length === 1) {
    return { kind: 'activate', id: detectedIds[0] };
  }
  if (detectedIds.length >= 2) {
    return { kind: 'choose' };
  }
  return { kind: 'none' };
}

/**
 * Map an agent id to its per-agent `agentDetected` context key.
 *
 * Hyphens are stripped from the leaf because VS Code `when`-clause parsing of
 * hyphens in key names is not guaranteed (a `-` risks being read as
 * subtraction). The agent id itself (e.g. 'claude-code') is unchanged
 * everywhere else; only this context-key name is sanitized.
 */
export function agentDetectedKey(id: string): string {
  return `ack.agentDetected.${id.replace(/-/g, '')}`;
}
