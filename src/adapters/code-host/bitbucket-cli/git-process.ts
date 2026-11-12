// Network Git calls may use the companion's native credentials. Local plumbing
// stays in Git; neither tokens nor authenticated environments return to fx.
import { CATEGORIES, DevkitError } from '../../../domain/errors.js';
import type { Vars } from '../../../domain/template.js';
import { errorEnvelope } from '../../../domain/toolchain/stderr.js';
import type { Process, ProcessResult, RunOptions } from '../../../ports/process.js';
import { serviceFlags } from '../../family/service.js';

import { BitbucketCli } from './client.js';

export class BitbucketGitProcess implements Process {
  private supported: boolean | undefined;

  constructor(
    private readonly process: Process,
    private readonly vars: Vars = {},
  ) {}

  which(binary: string, options?: Pick<RunOptions, 'cwd' | 'env'>): Promise<string | undefined> {
    return this.process.which(binary, options);
  }

  async run(vector: readonly string[], options: RunOptions = {}): Promise<ProcessResult> {
    if (!networkGit(vector)) return this.process.run(vector, options);
    const remaining = invocationBudget(options);
    if (!(await this.available(remaining))) return this.process.run(vector, remaining());
    const context = this.vars['context'];
    const cli = new BitbucketCli(this.process, context, this.vars);
    await cli.checkService(remaining());
    const scope = [...(context ? ['--use-context', context] : []), ...serviceFlags(this.vars)];
    const result = await this.process.run(
      ['bitbucket-cli', ...scope, 'git', '--fallback', '--', ...vector.slice(1)],
      remaining(),
    );
    preserveNativeFailure(result);
    return result;
  }

  private async available(remaining: () => RunOptions): Promise<boolean> {
    this.supported ??= await this.probe(remaining);
    return this.supported;
  }

  private async probe(remaining: () => RunOptions): Promise<boolean> {
    if (!(await this.process.which('bitbucket-cli', remaining()))) return false;
    const options = remaining();
    const help = await this.process.run(['bitbucket-cli', 'git', '--help'], {
      ...options,
      timeoutMs: Math.min(options.timeoutMs ?? 5000, 5000),
    });
    return help.code === 0 && help.stdout.includes('--fallback');
  }
}

function invocationBudget(options: RunOptions): () => RunOptions {
  const deadline =
    options.timeoutMs === undefined ? undefined : performance.now() + options.timeoutMs;
  return () => {
    if (deadline === undefined) return options;
    const timeoutMs = deadline - performance.now();
    if (timeoutMs <= 0)
      throw new DevkitError(
        'internal',
        'PROCESS_TIMEOUT',
        'Git authentication exceeded its deadline',
        {
          nextSteps: ['Retry the Git operation with a longer timeout.'],
        },
      );
    return { ...options, timeoutMs };
  };
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
    if (arg === 'clone' && localClone(vector.slice(i + 1))) return false;
    return ['clone', 'fetch', 'ls-remote', 'push'].includes(arg ?? '');
  }
  return false;
}

// A local source cannot use Bitbucket credentials, including before the manifest
// exists. Do not let a broken companion context interfere with a local clone.
function localClone(args: readonly string[]): boolean {
  const values = [
    '--origin',
    '-o',
    '--branch',
    '-b',
    '--depth',
    '--shallow-since',
    '--shallow-exclude',
    '--filter',
    '--jobs',
    '-j',
  ];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (values.includes(arg)) {
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg !== '--') continue;
    const source = arg === '--' ? (args[i + 1] ?? '') : arg;
    return (
      source.startsWith('file://') ||
      /^[a-z]:[\\/]/i.test(source) ||
      !/^(?:[a-z][a-z\d+.-]*:\/\/|[^/\\]+:)/i.test(source)
    );
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
