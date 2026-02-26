import { execFile } from 'child_process';
import { promisify } from 'util';
import type { RegistryService } from './registry.service.js';
import type { ConfigService } from './config.service.js';
import type { AdapterRegistry } from '../adapters/adapter.registry.js';
import type { FileIOService } from './fileio.service.js';
import type { RegistrySource } from './registry.types.js';
import type {
  ToolManifest,
  InstallRequest,
  InstallResult,
  RuntimeCheckResult,
} from './install.types.js';
import { ToolType, ConfigScope } from '../types/enums.js';

const execFileAsync = promisify(execFile);

/**
 * Map of runtime names to shell commands.
 *
 * Unknown runtimes use the runtime string directly as the command.
 */
const RUNTIME_COMMANDS: Record<string, string> = {
  node: 'node',
  python: 'python3',
  npx: 'npx',
  uvx: 'uvx',
};

/** Timeout for runtime availability checks (5 seconds). */
const RUNTIME_CHECK_TIMEOUT = 5000;

/**
 * Pure orchestrator service for one-click tool installation.
 *
 * Coordinates fetching tool content from the GitHub registry, validating
 * manifests, checking runtime requirements, and delegating writes to the
 * existing adapter/writer infrastructure.
 *
 * No VS Code API dependencies -- pure business logic, following the
 * ToolManagerService pattern from Phase 03-02.
 */
export class InstallService {
  constructor(
    private readonly registryService: RegistryService,
    private readonly configService: ConfigService,
    private readonly registry: AdapterRegistry,
    private readonly fileIOService: FileIOService,
    private readonly workspaceRoot?: string,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Install a tool from the registry.
   *
   * Routes by manifest type to the appropriate installer, wrapping in
   * try/catch to return structured results rather than throwing.
   */
  async install(request: InstallRequest): Promise<InstallResult> {
    // Normalize contentPath to avoid double slashes
    const normalizedRequest = {
      ...request,
      contentPath: request.contentPath.replace(/\/+$/, ''),
    };
    try {
      switch (normalizedRequest.manifest.type) {
        case 'mcp_server':
          return await this.installMcpServer(normalizedRequest);
        case 'skill':
          return await this.installSkill(normalizedRequest);
        case 'command':
          return await this.installCommand(normalizedRequest);
        case 'hook':
          return await this.installHook(normalizedRequest);
        case 'custom_prompt':
          return await this.installCustomPrompt(normalizedRequest);
        default:
          return {
            success: false,
            error: `Unsupported tool type: ${normalizedRequest.manifest.type}`,
            toolName: normalizedRequest.manifest.name,
            scope: normalizedRequest.scope,
          };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: message,
        toolName: normalizedRequest.manifest.name,
        scope: normalizedRequest.scope,
      };
    }
  }

  /**
   * Check whether a runtime command is available on the system PATH.
   *
   * Uses `child_process.execFile` with `--version` flag. Maps runtime
   * names to commands (e.g., 'python' -> 'python3'). Unknown runtimes
   * use the runtime string directly as the command.
   *
   * Returns warn-but-allow result -- caller decides whether to proceed.
   */
  async checkRuntime(runtime: string): Promise<RuntimeCheckResult> {
    const command = RUNTIME_COMMANDS[runtime] ?? runtime;

    try {
      const { stdout } = await execFileAsync(command, ['--version'], {
        timeout: RUNTIME_CHECK_TIMEOUT,
      });
      return { available: true, version: stdout.trim() };
    } catch {
      return {
        available: false,
        error: `${command} not found on PATH`,
      };
    }
  }

  /**
   * Fetch and validate a tool manifest from the registry.
   *
   * Delegates to RegistryService.fetchToolManifest().
   */
  async getToolManifest(
    source: RegistrySource,
    contentPath: string,
  ): Promise<ToolManifest> {
    return this.registryService.fetchToolManifest(source, contentPath);
  }

  /**
   * Check if a tool with the given name already exists at the specified scope.
   *
   * Used by the UI layer to show "Update" vs "Install" button and to
   * prompt before overwriting.
   */
  async checkConflict(
    name: string,
    type: string,
    scope: ConfigScope,
  ): Promise<boolean> {
    try {
      const toolType = type as ToolType;
      const existingTools = await this.configService.readToolsByScope(
        toolType,
        scope,
      );
      return existingTools.some((existing) => existing.name === name);
    } catch {
      // If we can't read the scope, assume no conflict
      return false;
    }
  }

  /**
   * Get existing env values for an MCP server at the given scope.
   *
   * Used to preserve user customizations on update -- reads the current
   * server config and extracts env values.
   */
  async getExistingEnvValues(
    name: string,
    scope: ConfigScope,
  ): Promise<Record<string, string>> {
    try {
      const existingTools = await this.configService.readToolsByScope(
        ToolType.McpServer,
        scope,
      );
      const existing = existingTools.find((t) => t.name === name);
      if (existing?.metadata?.env) {
        return existing.metadata.env as Record<string, string>;
      }
      return {};
    } catch {
      return {};
    }
  }

  // ---------------------------------------------------------------------------
  // Private installers
  // ---------------------------------------------------------------------------

  /**
   * Get the active adapter from the registry.
   * Throws if no adapter is active.
   */
  private getAdapter() {
    const adapter = this.registry.getActiveAdapter();
    if (!adapter) {
      throw new Error('No active platform adapter');
    }
    return adapter;
  }

  /**
   * Install an MCP server by building config and delegating to the adapter.
   *
   * Merges user-provided config values with manifest defaults.
   * Preserves existing env values on update.
   */
  private async installMcpServer(
    request: InstallRequest,
  ): Promise<InstallResult> {
    const { manifest, scope, configValues = {}, existingEnvValues = {} } = request;

    const adapter = this.getAdapter();

    // Build env object: manifest defaults < existing values < user-provided values
    const env: Record<string, string> = {};
    for (const [key, fieldDef] of Object.entries(manifest.config.env ?? {})) {
      env[key] =
        configValues[key] ??
        existingEnvValues[key] ??
        fieldDef.defaultValue ??
        '';
    }

    const serverConfig: Record<string, unknown> = {
      command: manifest.config.command,
      args: manifest.config.args ?? [],
      env,
    };

    await adapter.installMcpServer(scope, manifest.name, serverConfig);

    return {
      success: true,
      toolName: manifest.name,
      scope,
    };
  }

  /**
   * Install a skill by fetching files and delegating to the adapter.
   *
   * Downloads each file listed in manifest.files (default ['SKILL.md'])
   * from the registry, then passes file contents to the adapter which
   * handles directory creation and file writing internally.
   */
  private async installSkill(
    request: InstallRequest,
  ): Promise<InstallResult> {
    const { manifest, scope, source, contentPath } = request;

    const files = manifest.files ?? ['SKILL.md'];
    const adapter = this.getAdapter();

    // Fetch all file contents from the registry
    const fileContents: Array<{ name: string; content: string }> = [];
    for (const file of files) {
      const filePath = `${contentPath}/${file}`;
      const content = await this.registryService.fetchToolFile(source, filePath);
      fileContents.push({ name: file, content });
    }

    await adapter.installSkill(scope, manifest.name, fileContents);

    return {
      success: true,
      toolName: manifest.name,
      scope,
    };
  }

  /**
   * Install a command by fetching files and delegating to the adapter.
   *
   * Same pattern as installSkill but targets the commands directory.
   * The adapter handles single-file vs multi-file layout internally.
   */
  private async installCommand(
    request: InstallRequest,
  ): Promise<InstallResult> {
    const { manifest, scope, source, contentPath } = request;

    const files = manifest.files ?? [`${manifest.name}.md`];
    const adapter = this.getAdapter();

    // Fetch all file contents from the registry
    const fileContents: Array<{ name: string; content: string }> = [];
    for (const file of files) {
      const filePath = `${contentPath}/${file}`;
      const content = await this.registryService.fetchToolFile(source, filePath);
      fileContents.push({ name: file, content });
    }

    await adapter.installCommand(scope, manifest.name, fileContents);

    return {
      success: true,
      toolName: manifest.name,
      scope,
    };
  }

  /**
   * Install a hook by building a matcher group and delegating to the adapter.
   *
   * Builds the matcher group from manifest config (event, matcher, hooks).
   */
  private async installHook(
    request: InstallRequest,
  ): Promise<InstallResult> {
    const { manifest, scope } = request;

    const adapter = this.getAdapter();

    const eventName = manifest.config.event;
    if (!eventName) {
      throw new Error('Hook manifest missing config.event field');
    }

    const matcherGroup = {
      matcher: manifest.config.matcher ?? '',
      hooks: manifest.config.hooks ?? [],
    };

    await adapter.installHook(scope, eventName, matcherGroup);

    return {
      success: true,
      toolName: manifest.name,
      scope,
    };
  }

  /**
   * Install a custom_prompt (instruction/prompt file) via the Copilot adapter.
   *
   * Fetches the file content from the registry and delegates to
   * CopilotAdapter.installInstruction(). Always project-scoped.
   * Returns an error if the active adapter is not CopilotAdapter.
   */
  private async installCustomPrompt(
    request: InstallRequest,
  ): Promise<InstallResult> {
    const { manifest, source, contentPath } = request;
    const scope = ConfigScope.Project;

    const adapter = this.getAdapter();
    const { CopilotAdapter } = await import('../adapters/copilot/copilot.adapter.js');
    if (!(adapter instanceof CopilotAdapter)) {
      return {
        success: false,
        error: 'custom_prompt install is only supported for Copilot',
        toolName: manifest.name,
        scope,
      };
    }

    const files = manifest.files ?? [`${manifest.name}.md`];
    const fileName = files[0];
    const filePath = `${contentPath}/${fileName}`;
    const content = await this.registryService.fetchToolFile(source, filePath);

    await adapter.installInstruction(scope, fileName, content);

    return {
      success: true,
      toolName: manifest.name,
      scope,
    };
  }

}
