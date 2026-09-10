// Where the personal directory is. One function, so a test or the e2e harness
// relocates the whole of ~/.fx through FX_HOME.

import os from 'node:os';
import path from 'node:path';

import { DevkitError } from '../domain/errors.js';
import { windowsPathProblem } from '../domain/path.js';

export function fxHome(env: NodeJS.ProcessEnv): string {
  const home = env['FX_HOME'] ?? path.join(os.homedir(), '.fx');
  const problem = process.platform === 'win32' ? windowsPathProblem(path.resolve(home)) : undefined;
  if (problem) throw new DevkitError('config', 'FX_HOME_INVALID', problem);
  return home;
}
