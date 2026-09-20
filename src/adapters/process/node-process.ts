// Execute process vectors through the Process port. Missing executables return
// exit 127; bounded piped calls reject on timeout or cancellation and reap children.

import type { ChildProcess } from 'node:child_process';

import spawn from 'cross-spawn';

import { DevkitError } from '../../domain/errors.js';
import type { Process, ProcessResult, RunOptions } from '../../ports/process.js';

import { findExecutable, mergeEnvironment } from './executable.js';
import { supervisedRole } from './supervision.js';
import { terminateChild } from './terminate.js';

const ABORTED = 'PROCESS_ABORTED';
const GIVEN_UP = 'was given up on';
const CLOSE_GRACE_MS = 500;

// Interrupt children before other listeners run, then restore ordinary signal ownership.
interface Bounded {
  readonly interrupt: () => void;
}

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
const running = new Set<Bounded>();
const handlers = new Map<NodeJS.Signals, () => void>();

function adopt(entry: Bounded): () => void {
  if (handlers.size === 0) arm();
  running.add(entry);
  return () => {
    running.delete(entry);
    if (running.size === 0) disarm();
  };
}

function arm(): void {
  for (const signal of SIGNALS) {
    const handler = (): void => {
      const interrupted = [...running];
      running.clear();
      for (const entry of interrupted) {
        try {
          entry.interrupt();
        } catch {
          continue;
        }
      }
      const owned = process.listeners(signal).some((l) => l !== handler);
      disarm();
      if (!owned) process.kill(process.pid, signal);
    };
    handlers.set(signal, handler);
    process.prependListener(signal, handler);
  }
}

function disarm(): void {
  for (const [signal, handler] of handlers) process.off(signal, handler);
  handlers.clear();
}

export class NodeProcess implements Process {
  async run(vector: readonly string[], options: RunOptions = {}): Promise<ProcessResult> {
    const [binary, ...args] = vector;
    if (binary === undefined)
      return Promise.resolve({ code: 2, stdout: '', stderr: 'empty command' });
    if (options.signal?.aborted) throw hung(vector, ABORTED, GIVEN_UP);
    const env = mergeEnvironment(process.env, options.env);
    const resolved = await findExecutable(binary, { cwd: options.cwd, env });
    if (!resolved) return { code: 127, stdout: '', stderr: `command not found: ${binary}\n` };
    const runOptions = { ...options, env };
    return options.interactive === true
      ? this.runInteractive(resolved, args, runOptions)
      : this.runPiped(resolved, args, runOptions);
  }

  private runPiped(binary: string, args: string[], options: RunOptions): Promise<ProcessResult> {
    const vector = [binary, ...args];
    return new Promise((resolve, reject) => {
      // The lifecycle supervisor owns the group when this is one of its workers.
      const bounded = options.timeoutMs !== undefined || options.signal !== undefined;
      const ownGroup = bounded && process.platform !== 'win32' && supervisedRole() === undefined;
      const child = spawn(binary, args, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: ownGroup,
      });
      const release = bounded
        ? adopt({ interrupt: () => giveUp(ABORTED, 'was given up on when fx was interrupted') })
        : (): void => undefined;
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let settled = false;
      let failure: DevkitError | undefined;
      let closing: NodeJS.Timeout | undefined;
      const finish = (answer: () => void): void => {
        if (settled) return;
        settled = true;
        release();
        if (timer !== undefined) clearTimeout(timer);
        if (closing !== undefined) clearTimeout(closing);
        options.signal?.removeEventListener('abort', onAbort);
        answer();
      };
      // A surviving helper may retain the pipes after its parent is killed.
      const giveUp = (code: string, message: string): void => {
        if (settled || failure !== undefined) return;
        failure = hung(vector, code, message);
        killTree(child, ownGroup);
        closing = setTimeout(() => {
          child.stdout!.destroy();
          child.stderr!.destroy();
          finish(() => reject(failure));
        }, CLOSE_GRACE_MS);
      };
      const timer = timeoutOf(options.timeoutMs, giveUp);
      const onAbort = (): void => giveUp(ABORTED, GIVEN_UP);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      child.stdout!.on('data', (chunk: Buffer) => out.push(chunk));
      child.stderr!.on('data', (chunk: Buffer) => err.push(chunk));
      child.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT')
          finish(() =>
            resolve({ code: 127, stdout: '', stderr: `command not found: ${binary}\n` }),
          );
        else finish(() => reject(error));
      });
      child.on('close', (code) => {
        if (failure !== undefined) finish(() => reject(failure));
        else finish(() => resolve(resultOf(code, out, err)));
      });
      if (options.signal?.aborted === true) onAbort();
      child.stdin!.on('error', () => undefined);
      child.stdin!.end(options.input);
    });
  }

  private runInteractive(
    binary: string,
    args: string[],
    options: RunOptions,
  ): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: 'inherit',
      });
      child.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT')
          resolve({ code: 127, stdout: '', stderr: `command not found: ${binary}\n` });
        else reject(error);
      });
      child.on('close', (code) => resolve({ code: code ?? -1, stdout: '', stderr: '' }));
    });
  }

  which(
    binary: string,
    options: Pick<RunOptions, 'cwd' | 'env'> = {},
  ): Promise<string | undefined> {
    return findExecutable(binary, { ...options, env: mergeEnvironment(process.env, options.env) });
  }
}

function hung(vector: readonly string[], code: string, message: string): DevkitError {
  return new DevkitError('internal', code, `${vector[0] ?? ''} ${message}`, {
    hint: 'The tool hung or is waiting for input it cannot get.',
    nextSteps: [`Run \`${vector.join(' ')}\` by hand to see what it is waiting for.`],
  });
}

// Only a run a host waits on has nothing left to do once a companion command
// is given up on. A background run keeps its later phases, and whatever the
// killed child left in the worker's own group is reaped with that group.
function killTree(child: ChildProcess, ownGroup: boolean): void {
  if (supervisedRole() === 'foreground' && process.connected) process.send?.({ kind: 'abort' });
  terminateChild(child, ownGroup);
}

function timeoutOf(
  ms: number | undefined,
  giveUp: (code: string, message: string) => void,
): NodeJS.Timeout | undefined {
  if (ms === undefined) return undefined;
  return setTimeout(() => giveUp('PROCESS_TIMEOUT', `did not finish within ${ms}ms`), ms);
}

function resultOf(code: number | null, out: Buffer[], err: Buffer[]): ProcessResult {
  return {
    code: code ?? -1,
    stdout: Buffer.concat(out).toString('utf8'),
    stderr: Buffer.concat(err).toString('utf8'),
  };
}
