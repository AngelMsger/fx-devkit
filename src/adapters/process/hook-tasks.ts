// A detached supervisor owns the background worker. It inherits no host IO
// handles, and its entry point is supplied by composition rather than a manifest.

import { spawn } from 'node:child_process';

import { hookRequestArgs, type HookRequest } from '../../domain/harness/request.js';
import type { HookTasks } from '../../ports/hook-tasks.js';

import { unsupervised } from './supervision.js';

export class NodeHookTasks implements HookTasks {
  constructor(private readonly executable: readonly string[]) {}
  start(request: HookRequest): Promise<void> {
    return new Promise((resolve) => {
      const [binary, ...args] = this.executable;
      if (!binary) {
        resolve();
        return;
      }
      const child = spawn(binary, [...args, '__hook-background', ...hookRequestArgs(request)], {
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
        env: { ...process.env, ...unsupervised() },
      });
      child.once('error', () => resolve());
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  }
}
