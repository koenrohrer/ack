/**
 * Typed error classes for provider operations.
 *
 * All provider errors include the agent name for clear error messages
 * that identify which platform provider failed (e.g., "Claude Code: ...").
 * Callers can catch by type for targeted error handling.
 */

/**
 * Base class for all provider errors.
 * Includes the agent identity for context in error messages.
 */
export class ProviderError extends Error {
  readonly agentName: string;

  constructor(agentName: string, message: string) {
    super(`${agentName}: ${message}`);
    this.name = 'ProviderError';
    this.agentName = agentName;
  }
}

/**
 * Thrown when a config read or write operation fails.
 */
export class ProviderConfigError extends ProviderError {
  constructor(agentName: string, message: string) {
    super(agentName, message);
    this.name = 'ProviderConfigError';
  }
}

/**
 * Thrown when a required config file does not exist.
 */
export class ProviderFileNotFoundError extends ProviderError {
  readonly filePath: string;

  constructor(agentName: string, filePath: string) {
    super(agentName, `config file not found at ${filePath}`);
    this.name = 'ProviderFileNotFoundError';
    this.filePath = filePath;
  }
}

/**
 * Thrown when an operation is attempted on an unsupported scope.
 */
export class ProviderScopeError extends ProviderError {
  readonly scope: string;

  constructor(agentName: string, scope: string, operation: string) {
    super(agentName, `scope "${scope}" is not supported for ${operation}`);
    this.name = 'ProviderScopeError';
    this.scope = scope;
  }
}
