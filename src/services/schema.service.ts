import type { z } from 'zod';

/**
 * Result of schema validation.
 */
export type ValidationResult =
  | { success: true; data: unknown }
  | { success: false; error: z.ZodError };

/**
 * Service for validating data against named Zod schemas.
 *
 * Schemas are registered by name so validation callers reference them
 * with a string key rather than importing schema objects directly.
 * This decouples validation call sites from specific platform schemas.
 */
export class SchemaService {
  private readonly schemas = new Map<string, z.ZodType>();

  /**
   * Register one or more named schemas.
   *
   * Typically called once during extension activation with
   * the platform adapter's schema map.
   */
  registerSchemas(schemas: Record<string, z.ZodType>): void {
    for (const [key, schema] of Object.entries(schemas)) {
      this.schemas.set(key, schema);
    }
  }

  /**
   * Validate data against a registered schema.
   *
   * Returns `{ success: true, data }` with the parsed (and possibly
   * transformed) data on success, or `{ success: false, error }` with
   * a ZodError on validation failure.
   *
   * Throws if schemaKey is not registered -- this indicates a programming
   * error (typo in schema name), not invalid user data.
   */
  validate(schemaKey: string, data: unknown): ValidationResult {
    const schema = this.schemas.get(schemaKey);
    if (!schema) {
      throw new Error(
        `Schema "${schemaKey}" is not registered. Available: ${[...this.schemas.keys()].join(', ')}`,
      );
    }

    const result = schema.safeParse(data);
    if (result.success) {
      return { success: true, data: result.data };
    }

    return { success: false, error: result.error! };
  }

  /**
   * Check whether a schema is registered under the given key.
   */
  hasSchema(schemaKey: string): boolean {
    return this.schemas.has(schemaKey);
  }
}
