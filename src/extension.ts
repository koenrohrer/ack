import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Agent Config Keeper');
  context.subscriptions.push(outputChannel);

  outputChannel.appendLine('Agent Config Keeper activated');
}

export function deactivate(): void {
  // Cleanup handled by disposables in context.subscriptions
}
