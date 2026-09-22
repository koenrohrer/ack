import * as vscode from 'vscode';
import type { SwitchResult } from '../services/profile.types.js';

/**
 * Report the toggles a profile switch could not apply.
 *
 * When a toggle failed, shows a warning with every error and writes each
 * error to the ACK output channel. Reports nothing when no toggle failed.
 * Every caller of ProfileService.switchProfile uses this.
 */
export function reportSwitchFailures(
  result: SwitchResult,
  outputChannel: Pick<vscode.OutputChannel, 'appendLine'>,
): void {
  if (result.failed === 0) {
    return;
  }
  outputChannel.appendLine(`Profile switch: ${result.failed} toggle(s) failed:`);
  for (const error of result.errors) {
    outputChannel.appendLine(`  ${error}`);
  }
  void vscode.window.showWarningMessage(`${result.failed} toggle(s) failed: ${result.errors.join('; ')}`);
}
