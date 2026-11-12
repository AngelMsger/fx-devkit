// Network Git calls may use the companion's native credentials. Local plumbing
// stays in Git; neither tokens nor authenticated environments return to fx.
import { CATEGORIES, DevkitError } from '../../../domain/errors.js';
import { errorEnvelope } from '../../../domain/toolchain/stderr.js';
import type { Process, ProcessResult, RunOptions } from '../../../ports/process.js';

export class BitbucketGitProcess implements Process {
  private supported: Promise<boolean> | undefined;

  constructor(
    private readonly process: Process,
    private readonly scope: readonly string[] = [],
  ) {}

  which(binary: string, options?: Pick<RunOptions, 'cwd' | 'env'>): Promise<string | undefined> {
    return this.process.which(binary, options);
  }

  async run(vector: readonly string[], options: RunOptions = {}): Promise<ProcessResult> {
    if (!networkGit(vector) || !(await this.available(options)))
      return this.process.run(vector, options);
    const result = await this.process.run(
      ['bitbucket-cli', ...this.scope, 'git', '--fallback', '--', ...vector.slice(1)],
      options,
    );
    preserveNativeFailure(result);
    return result;
  }

  private available(options: RunOptions): Promise<boolean> {
    this.supported ??= this.probe(options);
    return this.supported;
  }

  private async probe(options: RunOptions): Promise<boolean> {
    if (!(await this.process.which('bitbucket-cli', options))) return false;
    const help = await this.process.run(['bitbucket-cli', 'git', '--help'], {
      ...options,
      timeoutMs: Math.min(options.timeoutMs ?? 5000, 5000),
    });
    return help.code === 0 && help.stdout.includes('--fallback');
  }
}

function networkGit(vector: readonly string[]): boolean {
  if (vector[0] !== 'git') return false;
  for (let i = 1; i < vector.length; i++) {
    const arg = vector[i];
    if (arg === '-C' || arg === '-c') {
      i++;
      continue;
    }
    if (arg === '--no-optional-locks') continue;
    return ['clone', 'fetch', 'ls-remote', 'push'].includes(arg ?? '');
  }
  return false;
}

// Setup failures carry recovery from the companion. A running Git keeps its own
// unstructured output and status, including non-fast-forward and missing refs.
function preserveNativeFailure(result: ProcessResult): void {
  if (result.code === 0) return;
  const error = errorEnvelope(result.stderr);
  const category = CATEGORIES.find((value) => value === error?.['category']);
  if (!category || typeof error?.['code'] !== 'string' || typeof error['message'] !== 'string')
    return;
  const next = error['next_steps'];
  throw new DevkitError(category, error['code'], error['message'], {
    ...(typeof error['hint'] === 'string' ? { hint: error['hint'] } : {}),
    ...(Array.isArray(next) && next.every((value): value is string => typeof value === 'string')
      ? { nextSteps: next }
      : {}),
  });
}
