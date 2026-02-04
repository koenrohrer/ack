/**
 * Typed error classes for adapter operations.
 *
 * All adapter errors include the agent name for clear error messages
 * that identify which platform adapter failed (e.g., "Claude Code: ...").
 * Callers can catch by type for targeted error handling.
 */

/**
 * Base class for all adapter errors.
 * Includes the agent identity for context in error messages.
 */
export class AdapterError extends Error {
  readonly agentName: string;

  constructor(agentName: string, message: string) {
    super(`${agentName}: ${message}`);
    this.name = 'AdapterError';
    this.agentName = agentName;
  }
}

/**
 * Thrown when a config read or write operation fails.
 */
export class AdapterConfigError extends AdapterError {
  constructor(agentName: string, message: string) {
    super(agentName, message);
    this.name = 'AdapterConfigError';
  }
}

/**
 * Thrown when a required config file does not exist.
 */
export class AdapterFileNotFoundError extends AdapterError {
  readonly filePath: string;

  constructor(agentName: string, filePath: string) {
    super(agentName, `config file not found at ${filePath}`);
    this.name = 'AdapterFileNotFoundError';
    this.filePath = filePath;
  }
}

/**
 * Thrown when an operation is attempted on an unsupported scope.
 */
export class AdapterScopeError extends AdapterError {
  readonly scope: string;

  constructor(agentName: string, scope: string, operation: string) {
    super(agentName, `scope "${scope}" is not supported for ${operation}`);
    this.name = 'AdapterScopeError';
    this.scope = scope;
  }
}
