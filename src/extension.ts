import * as vscode from 'vscode';
import { FileIOService } from './services/fileio.service.js';
import { BackupService } from './services/backup.service.js';
import { SchemaService } from './services/schema.service.js';
import { ConfigService } from './services/config.service.js';
import { AdapterRegistry } from './adapters/adapter.registry.js';
import { ClaudeCodeAdapter } from './adapters/claude-code/claude-code.adapter.js';
import { claudeCodeSchemas } from './adapters/claude-code/schemas.js';

/**
 * Service container for cross-module access to initialized services.
 *
 * Set during activate(), cleared during deactivate().
 * Future phases use getServices() to access the singleton instances.
 */
let services:
  | {
      configService: ConfigService;
      registry: AdapterRegistry;
      outputChannel: vscode.OutputChannel;
    }
  | undefined;

/**
 * Access the initialized service instances.
 *
 * Throws if called before activate() completes -- callers should
 * only use this from command handlers and event listeners, which
 * are guaranteed to run after activation.
 */
export function getServices(): {
  configService: ConfigService;
  registry: AdapterRegistry;
  outputChannel: vscode.OutputChannel;
} {
  if (!services) {
    throw new Error('Extension not activated');
  }
  return services;
}

export function activate(context: vscode.ExtensionContext): void {
  // 1. Output channel for diagnostics
  const outputChannel = vscode.window.createOutputChannel('Agent Config Keeper');
  context.subscriptions.push(outputChannel);

  // 2. Core services
  const fileIO = new FileIOService();
  const backup = new BackupService();
  const schemas = new SchemaService();

  // 3. Register Claude Code schemas
  schemas.registerSchemas(claudeCodeSchemas);

  // 4. Workspace root (undefined when no folder is open)
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // 5. Adapter setup
  const registry = new AdapterRegistry();
  const claudeAdapter = new ClaudeCodeAdapter(fileIO, schemas, workspaceRoot);
  registry.register(claudeAdapter);

  // 6. Config service (the main API for reading/writing tool configs)
  const configService = new ConfigService(fileIO, backup, schemas, registry);

  // 7. Store services for cross-module access
  services = { configService, registry, outputChannel };

  // 8. Auto-detect platform
  registry
    .detectAndActivate()
    .then((adapter) => {
      if (adapter) {
        outputChannel.appendLine(`Platform detected: ${adapter.displayName}`);
      } else {
        outputChannel.appendLine('No supported agent platform detected');
      }
    })
    .catch((err: unknown) => {
      outputChannel.appendLine(`Platform detection error: ${err}`);
    });

  // 9. Test command (temporary, for manual verification during development)
  const testCmd = vscode.commands.registerCommand(
    'agent-config-keeper.testReadAll',
    async () => {
      const adapter = registry.getActiveAdapter();
      if (!adapter) {
        vscode.window.showWarningMessage('No agent platform detected');
        return;
      }
      for (const type of adapter.supportedToolTypes) {
        const tools = await configService.readAllTools(type);
        outputChannel.appendLine(`${type}: ${tools.length} tools found`);
        for (const tool of tools) {
          outputChannel.appendLine(
            `  - ${tool.name} [${tool.scope}] ${tool.status}`,
          );
        }
      }
      outputChannel.show();
    },
  );
  context.subscriptions.push(testCmd);

  outputChannel.appendLine('Agent Config Keeper activated');
}

export function deactivate(): void {
  services = undefined;
}
