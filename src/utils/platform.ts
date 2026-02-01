import * as os from 'os';
import * as path from 'path';

export type SupportedPlatform = 'darwin' | 'linux' | 'win32';

/**
 * Returns the user's home directory.
 */
export function getHomeDir(): string {
  return os.homedir();
}

/**
 * Returns the current platform, narrowed to the three supported values.
 * Throws if running on an unsupported platform.
 */
export function getPlatform(): SupportedPlatform {
  const platform = process.platform;

  if (platform === 'darwin' || platform === 'linux' || platform === 'win32') {
    return platform;
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

/**
 * Returns the OS-specific managed config directory for Claude Code.
 *
 * - macOS: ~/Library/Application Support/ClaudeCode/
 * - Linux: /etc/claude-code/
 * - Windows: C:\ProgramData\ClaudeCode\
 */
export function getManagedConfigDir(): string {
  const platform = getPlatform();

  switch (platform) {
    case 'darwin':
      return path.join(getHomeDir(), 'Library', 'Application Support', 'ClaudeCode');
    case 'linux':
      return '/etc/claude-code';
    case 'win32':
      return path.join('C:', 'ProgramData', 'ClaudeCode');
  }
}
