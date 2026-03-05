/** Known agents with display names and CSS modifier classes. */
const KNOWN_AGENTS: Record<string, { label: string; className: string }> = {
  'claude-code': { label: 'Claude', className: 'agent-badge--claude-code' },
  'codex': { label: 'Codex', className: 'agent-badge--codex' },
  'copilot': { label: 'Copilot', className: 'agent-badge--copilot' },
  'all': { label: 'All Agents', className: 'agent-badge--all' },
};

interface AgentBadgeProps {
  agents?: string[];
}

/**
 * Visual badge showing which agents a tool supports.
 * Empty/missing agents = all agents (backward compatible).
 */
export function AgentBadge({ agents }: AgentBadgeProps) {
  // Treat empty or missing as "all agents"
  if (!agents || agents.length === 0 || agents.includes('all')) {
    return <span className="agent-badge agent-badge--all">All Agents</span>;
  }

  // Single agent - show that agent's badge
  if (agents.length === 1) {
    const agent = agents[0];
    const known = KNOWN_AGENTS[agent];
    return (
      <span className={`agent-badge ${known?.className ?? 'agent-badge--unknown'}`}>
        {known?.label ?? agent}
      </span>
    );
  }

  // Multiple specific agents - show each
  return (
    <div className="agent-badges">
      {agents.map((agent) => {
        const known = KNOWN_AGENTS[agent];
        return (
          <span key={agent} className={`agent-badge ${known?.className ?? 'agent-badge--unknown'}`}>
            {known?.label ?? agent}
          </span>
        );
      })}
    </div>
  );
}
