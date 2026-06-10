import { execFile } from 'child_process';
import { promisify } from 'util';
import type { RegistryService } from './registry.service.js';
import type { ConfigService } from './config.service.js';
import type { AdapterRegistry } from '../adapters/adapter.registry.js';
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

type InstructionInstallAdapter = {
  installInstruction(
    scope: ConfigScope,
    filename: string,
    content: string,
  ): Promise<void>;
};

function hasInstructionInstaller(adapter: unknown): adapter is InstructionInstallAdapter {
  return typeof (adapter as { installInstruction?: unknown }).installInstruction === 'function';
}

type CustomPromptInstallAdapter = {
  getCustomPromptInstallScope(): ConfigScope;
  getCustomPromptInstallName(manifestName: string): string;
  installCustomPrompt(manifestName: string, content: string): Promise<void>;
};

function hasCustomPromptInstaller(adapter: unknown): adapter is CustomPromptInstallAdapter {
  return typeof (adapter as { installCustomPrompt?: unknown }).installCustomPrompt === 'function';
}

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
   * Resolve where a custom prompt will be installed for the active adapter.
   */
  getCustomPromptInstallScope(requestedScope: ConfigScope): ConfigScope {
    const adapter = this.getAdapter();
    if (hasInstructionInstaller(adapter)) {
      return ConfigScope.Project;
    }
    if (hasCustomPromptInstaller(adapter)) {
      return adapter.getCustomPromptInstallScope();
    }
    return requestedScope;
  }

  /**
   * Resolve the displayed identity and scope of a custom prompt destination.
   */
  getCustomPromptInstallTarget(
    manifest: ToolManifest,
    requestedScope: ConfigScope,
  ): { name: string; scope: ConfigScope } {
    const adapter = this.getAdapter();
    const files = manifest.files ?? [`${manifest.name}.md`];
    const fileName = files[0] ?? `${manifest.name}.md`;
    const scope = this.getCustomPromptInstallScope(requestedScope);

    if (hasInstructionInstaller(adapter)) {
      if (fileName === 'copilot-instructions.md') {
        return { name: 'copilot-instructions', scope };
      }
      if (fileName.endsWith('.instructions.md')) {
        return { name: fileName.slice(0, -'.instructions.md'.length), scope };
      }
      if (fileName.endsWith('.prompt.md')) {
        return { name: fileName.slice(0, -'.prompt.md'.length), scope };
      }
    }

    if (hasCustomPromptInstaller(adapter)) {
      return {
        name: adapter.getCustomPromptInstallName(manifest.name),
        scope,
      };
    }

    return { name: manifest.name, scope };
  }

  /**
   * Return an error when a manifest name cannot identify its installed prompt.
   */
  getCustomPromptValidationError(
    manifest: ToolManifest,
    requestedScope: ConfigScope,
  ): string | undefined {
    const adapter = this.getAdapter();
    const target = this.getCustomPromptInstallTarget(manifest, requestedScope);
    if (target.name === manifest.name) {
      return undefined;
    }
    return `custom_prompt name "${manifest.name}" does not match installed name "${target.name}" for ${adapter.displayName}`;
  }

  /**
   * Install custom prompt content that has already been fetched by the caller.
   *
   * Repo-sourced installs use this entry point so they can preserve authenticated
   * RepoScanner fetching while sharing adapter-specific placement behavior.
   */
  async installCustomPromptContent(
    manifest: ToolManifest,
    content: string,
    requestedScope: ConfigScope,
    allowOverwrite = false,
  ): Promise<InstallResult> {
    const adapter = this.getAdapter();
    if (!adapter.supportedToolTypes.has(ToolType.CustomPrompt)) {
      return {
        success: false,
        error: `custom_prompt install is not supported for ${adapter.displayName}`,
        toolName: manifest.name,
        scope: requestedScope,
      };
    }

    const target = this.getCustomPromptInstallTarget(manifest, requestedScope);
    const validationError = this.getCustomPromptValidationError(
      manifest,
      requestedScope,
    );
    if (validationError) {
      return {
        success: false,
        error: validationError,
        toolName: manifest.name,
        scope: target.scope,
      };
    }

    if (
      !allowOverwrite &&
      await this.checkConflict(target.name, manifest.type, target.scope)
    ) {
      return {
        success: false,
        error: `"${target.name}" already exists at ${target.scope} scope`,
        toolName: manifest.name,
        scope: target.scope,
      };
    }

    const files = manifest.files ?? [`${manifest.name}.md`];
    const fileName = files[0] ?? `${manifest.name}.md`;

    if (hasInstructionInstaller(adapter)) {
      await adapter.installInstruction(target.scope, fileName, content);

      return {
        success: true,
        toolName: manifest.name,
        scope: target.scope,
      };
    }

    if (hasCustomPromptInstaller(adapter)) {
      await adapter.installCustomPrompt(manifest.name, content);

      return {
        success: true,
        toolName: manifest.name,
        scope: target.scope,
      };
    }

    return {
      success: false,
      error: `custom_prompt install is not supported for ${adapter.displayName}`,
      toolName: manifest.name,
      scope: requestedScope,
    };
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
   * Install a custom_prompt (instruction/prompt file) for the active adapter.
   *
   * Copilot exposes installInstruction(); Codex prompts are user-scoped
   * markdown files under ~/.codex/prompts.
   */
  private async installCustomPrompt(
    request: InstallRequest,
  ): Promise<InstallResult> {
    const { manifest, source, contentPath } = request;

    const adapter = this.getAdapter();
    if (!adapter.supportedToolTypes.has(ToolType.CustomPrompt)) {
      return {
        success: false,
        error: `custom_prompt install is not supported for ${adapter.displayName}`,
        toolName: manifest.name,
        scope: request.scope,
      };
    }

    const files = manifest.files ?? [`${manifest.name}.md`];
    const fileName = files[0] ?? `${manifest.name}.md`;
    const filePath = `${contentPath}/${fileName}`;
    const content = await this.registryService.fetchToolFile(source, filePath);

    return this.installCustomPromptContent(
      manifest,
      content,
      request.scope,
      request.allowOverwrite,
    );
  }

}
