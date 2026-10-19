// Recognize the local-git provider only from its supported layout and a verified bare repository.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ImportProvider } from '../../../domain/import/infer.js';
import type { Process } from '../../../ports/process.js';
import { runGit } from '../../git/run.js';

export async function identifyLocalGitRemote(
  process: Process,
  upstream: string,
): Promise<ImportProvider | undefined> {
  let directory = upstream;
  if (upstream.startsWith('file://')) {
    try {
      directory = fileURLToPath(upstream);
    } catch {
      return undefined;
    }
  }
  if (!path.isAbsolute(directory) || !directory.endsWith('.git')) return undefined;
  const project = path.dirname(directory);
  if (path.basename(project).length === 0) return undefined;
  const result = await runGit(process, [
    '--git-dir',
    directory,
    'rev-parse',
    '--is-bare-repository',
  ]);
  if (result.code !== 0 || result.stdout.trim() !== 'true') return undefined;
  return { provider: 'local-git', host: path.dirname(project) };
}
