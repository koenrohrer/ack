import * as vscode from 'vscode';
import * as path from 'path';
import { access, readFile } from 'fs/promises';
import { ConfigScope, ToolType } from '../types/enums.js';
import type { AgentProvider } from '../types/provider.js';
import {
  readDirFiles,
  resolveInstallScopes,
  buildInstalledMessage,
  type NamedFile,
} from './local-install.utils.js';

/**
 * Install individual tools from local disk through the provider seam.
 *
 * Phase 2 scope: skills (folder) and commands (file or folder). MCP and
 * custom-prompt/instruction install are handled elsewhere (dedicated commands
 * today; MCP is generalized behind the MCP seam in Phase 4). Content is read
 * from disk and written via the active provider's `installSkill`/`installCommand`
 * — no network access.
 */
export class LocalInstallService {
  /**
   * Install a tool of the given type from local disk.
   *
   * Returns true when something was installed, false when the user cancelled
   * or the type is not handled by local install.
   */
  async install(provider: AgentProvider, toolType: ToolType): Promise<boolean> {
    switch (toolType) {
      case ToolType.Skill:
        return this.installSkill(provider);
      case ToolType.Command:
        return this.installCommand(provider);
      default:
        return false;
    }
  }

  private async installSkill(provider: AgentProvider): Promise<boolean> {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: 'Select a skill folder to install',
      openLabel: 'Install Skill',
    });
    if (!picked || picked.length === 0) {
      return false;
    }

    const folder = picked[0].fsPath;
    const skillName = path.basename(folder);
    const { files, skippedDirs } = await readDirFiles(folder);
    if (files.length === 0) {
      vscode.window.showErrorMessage(`"${skillName}" has no files to install.`);
      return false;
    }

    const scope = await this.pickScope(provider, ToolType.Skill);
    if (scope === undefined) {
      return false;
    }
    if (!(await this.confirmOverwrite(provider, ToolType.Skill, scope, skillName))) {
      return false;
    }

    await provider.installSkill(scope, skillName, files);
    vscode.window.showInformationMessage(
      buildInstalledMessage('Skill', skillName, files.length, skippedDirs),
    );
    return true;
  }

  private async installCommand(provider: AgentProvider): Promise<boolean> {
    const kind = await vscode.window.showQuickPick(
      [
        { label: 'Single file', source: 'file' as const },
        { label: 'Folder (multi-file)', source: 'folder' as const },
      ],
      { title: 'Install Command', placeHolder: 'Install a single command file or a folder?' },
    );
    if (!kind) {
      return false;
    }

    let commandName: string;
    let files: NamedFile[];
    let skippedDirs: string[] = [];

    if (kind.source === 'file') {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        title: 'Select a command file',
        openLabel: 'Install Command',
      });
      if (!picked || picked.length === 0) {
        return false;
      }
      const file = picked[0].fsPath;
      const fileName = path.basename(file);
      commandName = path.basename(fileName, path.extname(fileName));
      files = [{ name: fileName, content: await readFile(file, 'utf-8') }];
    } else {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: 'Select a command folder',
        openLabel: 'Install Command',
      });
      if (!picked || picked.length === 0) {
        return false;
      }
      const folder = picked[0].fsPath;
      commandName = path.basename(folder);
      const res = await readDirFiles(folder);
      files = res.files;
      skippedDirs = res.skippedDirs;
      if (files.length === 0) {
        vscode.window.showErrorMessage(`"${commandName}" has no files to install.`);
        return false;
      }
    }

    const scope = await this.pickScope(provider, ToolType.Command);
    if (scope === undefined) {
      return false;
    }
    // A single-file command lands under its file name; a multi-file command
    // lands under a folder named for the command.
    const conflictName = files.length === 1 ? files[0].name : commandName;
    if (!(await this.confirmOverwrite(provider, ToolType.Command, scope, conflictName))) {
      return false;
    }

    await provider.installCommand(scope, commandName, files);
    vscode.window.showInformationMessage(
      buildInstalledMessage('Command', commandName, files.length, skippedDirs),
    );
    return true;
  }

  private async pickScope(
    provider: AgentProvider,
    toolType: ToolType.Skill | ToolType.Command,
  ): Promise<ConfigScope | undefined> {
    const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
    const scopes = resolveInstallScopes(
      provider,
      toolType === ToolType.Skill ? 'skill' : 'command',
      hasWorkspace,
    );

    if (scopes.length === 0) {
      vscode.window.showErrorMessage(
        'No install location available. Open a workspace folder and try again.',
      );
      return undefined;
    }
    if (scopes.length === 1) {
      return scopes[0];
    }

    interface ScopeItem extends vscode.QuickPickItem {
      scope: ConfigScope;
    }
    const items: ScopeItem[] = scopes.map((scope) => ({
      label: scope === ConfigScope.User ? 'User (Global)' : 'Project (Workspace)',
      scope,
    }));
    const pick = await vscode.window.showQuickPick(items, {
      title: 'Install Location',
      placeHolder: 'Select where to install',
    });
    return pick?.scope;
  }

  private async confirmOverwrite(
    provider: AgentProvider,
    toolType: ToolType.Skill | ToolType.Command,
    scope: ConfigScope,
    name: string,
  ): Promise<boolean> {
    let baseDir: string;
    try {
      baseDir =
        toolType === ToolType.Skill
          ? provider.getSkillsDir(scope)
          : provider.getCommandsDir(scope);
    } catch {
      // Target directory not resolvable (e.g. Copilot agents) -- let the
      // provider's installer own any overwrite.
      return true;
    }

    const target = path.join(baseDir, name);
    try {
      await access(target);
    } catch {
      return true; // does not exist
    }

    const choice = await vscode.window.showWarningMessage(
      `"${name}" already exists at this scope. Overwrite?`,
      { modal: true },
      'Overwrite',
    );
    return choice === 'Overwrite';
  }
}
