// The supervisor never loads worker application code. Its timer stays live
// when the worker blocks synchronously; termination of the supervisor also
// reaps the worker group before returning an empty lifecycle result.

import { spawn, type ChildProcess } from 'node:child_process';

import type { LifecycleRun, LifecycleRunner } from '../../ports/lifecycle-runner.js';

import { mergeEnvironment } from './executable.js';
import { terminateChild } from './terminate.js';

export class NodeLifecycleRunner implements LifecycleRunner {
  run(input: LifecycleRun): Promise<string> {
    return new Promise((resolve) => {
      let child: ChildProcess | undefined;
      let text = '';
      let done = false;
      const finish = (value: string): void => {
        if (done) return;
        done = true;
        releaseSignals();
        clearTimeout(timer);
        if (child) dispose(child);
        resolve(value);
      };
      const releaseSignals = listenForTermination(() => finish(''));
      const timer = setTimeout(() => finish(''), input.timeoutMs);
      try {
        child = startWorker(input);
      } catch {
        finish('');
        return;
      }
      if (!child) {
        finish('');
        return;
      }
      observeWorker({
        child,
        input,
        finish,
        isDone: () => done,
        receive: (chunk) => {
          text += chunk;
          if (Buffer.byteLength(text) > 8192) finish('');
        },
        complete: (code) => finish(code === 0 ? text : ''),
      });
    });
  }
}

function startWorker(input: LifecycleRun): ChildProcess | undefined {
  const [binary, ...args] = input.vector;
  if (!binary) return undefined;
  return spawn(binary, args, {
    stdio: ['pipe', 'pipe', 'ignore', 'ipc'],
    detached: process.platform !== 'win32',
    windowsHide: true,
    env: mergeEnvironment(process.env, { ...input.env, FX_LIFECYCLE_WORKER: '1' }),
  });
}

interface WorkerObservation {
  readonly child: ChildProcess;
  readonly input: LifecycleRun;
  readonly finish: (value: string) => void;
  readonly isDone: () => boolean;
  readonly receive: (chunk: string) => void;
  readonly complete: (code: number | null) => void;
}

function observeWorker(scope: WorkerObservation): void {
  const { child, input, finish } = scope;
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', scope.receive);
  child.on('message', (message) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      'kind' in message &&
      message.kind === 'abort'
    )
      finish('');
  });
  child.on('error', () => finish(''));
  child.on('close', scope.complete);
  child.stdin!.on('error', () => {});
  void input.input.then(
    (text) => {
      if (scope.isDone()) return;
      if (Buffer.byteLength(text) > 65536) {
        finish('');
        return;
      }
      child.stdin!.end(text);
    },
    () => finish(''),
  );
}

function listenForTermination(abort: () => void): () => void {
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  for (const signal of signals) process.once(signal, abort);
  return () => {
    for (const signal of signals) process.off(signal, abort);
  };
}

function dispose(child: ChildProcess): void {
  terminateChild(child, true);
  child.stdin?.destroy();
  child.stdout?.destroy();
  if (child.connected) child.disconnect();
  child.unref();
}
