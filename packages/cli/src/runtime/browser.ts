import { spawn } from 'node:child_process';
import process from 'node:process';

/**
 * Cross-platform default-browser opening.
 *
 * Per `.dev/specs/CLI_INSTALLER.md` §8: after health succeeds, open
 * `http://127.0.0.1:<port>/` in the user's default browser.
 *
 * This deliberately avoids a dependency on the `open` npm package: the CLI
 * must stay thin and the platform matrix is small (xdg-open / open / cmd).
 */

export class BrowserOpenError extends Error {
  public override readonly name = 'BrowserOpenError';
  constructor(message: string) {
    super(message);
  }
}

interface PlatformOpener {
  cmd: string;
  args: (url: string) => string[];
}

function openerForPlatform(platform: NodeJS.Platform): PlatformOpener | null {
  switch (platform) {
    case 'darwin':
      return { cmd: 'open', args: (url) => [url] };
    case 'win32':
      // cmd /c start "" <url> — empty title arg prevents quoted-URL mangling.
      return { cmd: process.env.ComSpec ?? 'cmd.exe', args: (url) => ['/c', 'start', '', url] };
    default:
      // Linux/BSD and everything Unix-like with a freedesktop session.
      return { cmd: 'xdg-open', args: (url) => [url] };
  }
}

/**
 * Open `url` in the default browser. Never throws for a failed spawn —
 * browser opening is best-effort; the CLI prints the URL regardless.
 * Returns true when the opener process launched.
 */
export async function openInBrowser(url: string): Promise<boolean> {
  const opener = openerForPlatform(process.platform);
  if (opener === null) {
    return false;
  }
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const child = spawn(opener.cmd, opener.args(url), {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.once('error', () => {
    resolve(false);
  });
  child.once('spawn', () => {
    child.unref();
    resolve(true);
  });
  return promise;
}
