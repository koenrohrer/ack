import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SwitchResult } from '../../services/profile.types.js';
import { reportSwitchFailures } from '../../views/profile-switch-report.js';
import { window as vscodeWindow } from './helpers/vscode-stub.js';

function result(failed: number, errors: string[]): SwitchResult {
  return { success: failed === 0, toggled: 1, skipped: 0, failed, errors, incompatibleSkipped: [], nonToggleableSkipped: 0 };
}

let lines: string[];
const outputChannel = { appendLine: (line: string) => lines.push(line) };

beforeEach(() => {
  lines = [];
  vscodeWindow.showWarningMessage = vi.fn(async () => undefined);
});

describe('reportSwitchFailures', () => {
  it('shows a warning with every error when a toggle failed', () => {
    reportSwitchFailures(result(2, ['Failed to toggle a', 'Failed to toggle b']), outputChannel);

    expect(vscodeWindow.showWarningMessage).toHaveBeenCalledWith(
      '2 toggle(s) failed: Failed to toggle a; Failed to toggle b',
    );
  });

  it('writes every error to the output channel when a toggle failed', () => {
    reportSwitchFailures(result(2, ['Failed to toggle a', 'Failed to toggle b']), outputChannel);

    expect(lines).toEqual([
      'Profile switch: 2 toggle(s) failed:',
      '  Failed to toggle a',
      '  Failed to toggle b',
    ]);
  });

  it('reports nothing when no toggle failed', () => {
    reportSwitchFailures(result(0, []), outputChannel);

    expect(vscodeWindow.showWarningMessage).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });
});
