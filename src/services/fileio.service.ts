import * as fs from 'fs/promises';
import * as path from 'path';
import writeFileAtomic from 'write-file-atomic';
import { safeJsonParse } from '../utils/json.js';
import type { ConfigReadResult } from '../types/config.js';

/**
 * Lazy-loaded smol-toml parse and stringify functions.
 *
 * smol-toml is ESM-only but this project compiles as CJS under Node16.
 * Dynamic import works at runtime (Node supports importing ESM from CJS
 * via dynamic import) and esbuild bundles it correctly at build time.
 * We define our own interface to avoid TypeScript ESM/CJS type import errors.
 */
interface TomlModule {
  parse: (input: string) => Record<string, unknown>;
  stringify: (input: Record<string, unknown>) => string;
}
let _toml: TomlModule | undefined;
async function loadToml(): Promise<TomlModule> {
  if (!_toml) {
    _toml = await import('smol-toml') as TomlModule;
  }
  return _toml;
}

/**
 * Lazy-loaded js-yaml load and dump functions.
 *
 * Same rationale as smol-toml above: we dynamic-import and define our own
 * minimal interface to avoid ESM/CJS type-import friction (js-yaml ships no
 * bundled types and `@types/js-yaml` is not a dependency). js-yaml's ESM build
 * exposes `load`/`dump` on the namespace; the `default ?? mod` fallback covers
 * the CJS-interop shape esbuild may produce.
 */
interface YamlModule {
  load: (input: string) => unknown;
  dump: (input: Record<string, unknown>) => string;
}
let _yaml: YamlModule | undefined;
async function loadYaml(): Promise<YamlModule> {
  if (!_yaml) {
    const mod = await import('js-yaml') as unknown as YamlModule & { default?: YamlModule };
    _yaml = (mod.default ?? mod) as YamlModule;
  }
  return _yaml;
}

/**
 * Service for safe filesystem operations.
 *
 * Reads JSON files with lenient parsing (comments, trailing commas).
 * Writes files atomically using write-file-atomic (write-to-temp-then-rename)
 * to prevent data loss on crash.
 */
export class FileIOService {
  /**
   * Read and parse a JSON file, handling JSONC (comments, trailing commas).
   *
   * Returns `{ success: true, data: null }` when the file does not exist --
   * a missing file is a valid state (config not yet created).
   * Returns `{ success: false, error, filePath }` for permission errors or
   * malformed JSON that cannot be repaired.
   */
  async readJsonFile<T>(filePath: string): Promise<ConfigReadResult<T | null>> {
    let content: string;

    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return { success: true, data: null };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, filePath };
    }

    const parseResult = safeJsonParse(content);
    if (!parseResult.success) {
      return { success: false, error: parseResult.error, filePath };
    }

    return { success: true, data: parseResult.data as T };
  }

  /**
   * Write JSON data to a file atomically.
   *
   * Creates parent directories if they do not exist.
   * Serializes with 2-space indentation and trailing newline.
   * Throws on write failure -- callers are expected to handle errors.
   */
  async writeJsonFile(filePath: string, data: unknown): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const content = JSON.stringify(data, null, 2) + '\n';
    await writeFileAtomic(filePath, content, 'utf-8');
  }

  /**
   * Read a text file as UTF-8.
   *
   * Returns null when the file does not exist.
   * Throws on permission or other filesystem errors.
   */
  async readTextFile(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Write text content to a file atomically.
   *
   * Creates parent directories if they do not exist.
   */
  async writeTextFile(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await writeFileAtomic(filePath, content, 'utf-8');
  }

  /**
   * Delete a file.
   *
   * Swallows ENOENT -- deleting a missing file is a no-op success.
   * Rethrows other errors.
   */
  async deleteFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return;
      }
      throw err;
    }
  }

  /**
   * Move (rename) a file.
   *
   * Creates the destination parent directory if it does not exist.
   */
  async moveFile(src: string, dest: string): Promise<void> {
    const dir = path.dirname(dest);
    await fs.mkdir(dir, { recursive: true });
    await fs.rename(src, dest);
  }

  /**
   * Check whether a file exists and is accessible.
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List subdirectory names within a directory.
   *
   * Follows symlinks: a symlink whose target is a directory is included.
   * Returns an empty array if the directory does not exist.
   */
  async listDirectories(dirPath: string): Promise<string[]> {
    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return [];
      }
      throw err;
    }

    const results: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        results.push(entry.name);
      } else if (entry.isSymbolicLink()) {
        // Resolve symlink to check if target is a directory
        try {
          const resolved = await fs.stat(path.join(dirPath, entry.name));
          if (resolved.isDirectory()) {
            results.push(entry.name);
          }
        } catch {
          // Broken symlink -- skip silently
        }
      }
    }
    return results;
  }

  /**
   * List file names within a directory, optionally filtering by extension.
   *
   * Follows symlinks: a symlink whose target is a file is included.
   * Returns an empty array if the directory does not exist.
   */
  async listFiles(dirPath: string, extension?: string): Promise<string[]> {
    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return [];
      }
      throw err;
    }

    const results: string[] = [];
    for (const entry of entries) {
      const isFile = entry.isFile() || (entry.isSymbolicLink() && await this.isSymlinkToFile(dirPath, entry.name));
      if (isFile && (!extension || entry.name.endsWith(extension))) {
        results.push(entry.name);
      }
    }
    return results;
  }

  /**
   * Check whether a symlink resolves to a regular file.
   */
  private async isSymlinkToFile(dirPath: string, name: string): Promise<boolean> {
    try {
      const resolved = await fs.stat(path.join(dirPath, name));
      return resolved.isFile();
    } catch {
      return false;
    }
  }

  /**
   * Read and parse a TOML file.
   *
   * Returns `{ success: true, data: null }` when the file does not exist --
   * a missing file is a valid state (config not yet created).
   * Returns `{ success: false, error, filePath }` for permission errors or
   * malformed TOML that cannot be parsed.
   */
  async readTomlFile<T>(filePath: string): Promise<ConfigReadResult<T | null>> {
    let content: string;

    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return { success: true, data: null };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, filePath };
    }

    try {
      const { parse } = await loadToml();
      const parsed = parse(content);
      return { success: true, data: parsed as T };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, filePath };
    }
  }

  /**
   * Write data to a TOML file atomically.
   *
   * Creates parent directories if they do not exist.
   * Serializes using smol-toml's stringify with trailing newline.
   * Throws on write failure -- callers are expected to handle errors.
   */
  async writeTomlFile(filePath: string, data: Record<string, unknown>): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const { stringify } = await loadToml();
    const content = stringify(data) + '\n';
    await writeFileAtomic(filePath, content, 'utf-8');
  }

  /**
   * Read and parse a YAML file.
   *
   * Returns `{ success: true, data: null }` when the file does not exist --
   * a missing file is a valid state (config not yet created).
   * Returns `{ success: false, error, filePath }` for permission errors or
   * malformed YAML that cannot be parsed.
   *
   * Mirrors {@link readTomlFile}; used by HermesProvider for config.yaml.
   */
  async readYamlFile<T>(filePath: string): Promise<ConfigReadResult<T | null>> {
    let content: string;

    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return { success: true, data: null };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, filePath };
    }

    try {
      const { load } = await loadYaml();
      const parsed = load(content);
      // An empty YAML document parses to undefined -- treat as an empty config.
      return { success: true, data: (parsed ?? null) as T };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, filePath };
    }
  }

  /**
   * Write data to a YAML file atomically.
   *
   * Creates parent directories if they do not exist.
   * Serializes using js-yaml's dump with trailing newline.
   * Throws on write failure -- callers are expected to handle errors.
   *
   * Mirrors {@link writeTomlFile}.
   */
  async writeYamlFile(filePath: string, data: Record<string, unknown>): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const { dump } = await loadYaml();
    const content = dump(data);
    await writeFileAtomic(filePath, content, 'utf-8');
  }
}

/**
 * Type guard for Node.js system errors with a `code` property.
 */
function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
