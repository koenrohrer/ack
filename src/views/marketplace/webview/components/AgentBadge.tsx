/** Display names for known agents. */
const AGENT_DISPLAY_NAMES: Record<string, string> = {
  'claude-code': 'Claude',
  'codex': 'Codex',
  'copilot': 'Copilot',
  'all': 'All Agents',
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
    return (
      <span className={`agent-badge agent-badge--${agent}`}>
        {AGENT_DISPLAY_NAMES[agent] ?? agent}
      </span>
    );
  }

  // Multiple specific agents - show each
  return (
    <div className="agent-badges">
      {agents.map((agent) => (
        <span key={agent} className={`agent-badge agent-badge--${agent}`}>
          {AGENT_DISPLAY_NAMES[agent] ?? agent}
        </span>
      ))}
    </div>
  );
}
