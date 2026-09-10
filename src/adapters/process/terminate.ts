// Only an owned child PID is eligible for cleanup. Windows has no POSIX
// process groups; taskkill traverses the child tree while its root is alive.

import { spawnSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';

export function terminateChild(child: ChildProcess, group = false): void {
  if (child.pid === undefined) return;
  if (
    (!group || process.platform === 'win32') &&
    (child.exitCode !== null || child.signalCode !== null)
  )
    return;
  try {
    if (process.platform === 'win32') {
      const root = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows';
      const result = spawnSync(
        path.join(root, 'System32', 'taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'],
        {
          stdio: 'ignore',
          windowsHide: true,
          timeout: 500,
        },
      );
      if (result.status === 0) return;
    } else if (group) {
      process.kill(-child.pid, 'SIGKILL');
      return;
    }
  } catch {
    // Fall back to the direct child; never broaden cleanup to an image name.
  }
  child.kill('SIGKILL');
}
