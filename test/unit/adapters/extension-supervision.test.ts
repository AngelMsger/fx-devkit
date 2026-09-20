import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

import { ExtensionHookProtocol } from '../../../src/adapters/agent-host/extension-hooks.js';

type Callback = (event: unknown, context: { cwd: string }) => Promise<void>;
const roots: string[] = [];
const controllers: ChildProcess[] = [];

afterEach(() => {
  for (const child of controllers.splice(0)) child.kill('SIGKILL');
  for (const root of roots.splice(0)) {
    const pidFile = path.join(root, 'worker.pid');
    if (existsSync(pidFile)) {
      try {
        process.kill(-Number(readFileSync(pidFile, 'utf8')), 'SIGKILL');
      } catch {
        /* Already reaped. */
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
});

function compile(text: string): string {
  return ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function fixture(timeout: number): { root: string; controller: string; heartbeat: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'fx-extension-supervision-'));
  roots.push(root);
  const heartbeat = path.join(root, 'heartbeat');
  const worker = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(path.join(root, 'worker.pid'))},String(process.pid));setInterval(()=>fs.writeFileSync(${JSON.stringify(heartbeat)},String(Date.now())),20);`;
  writeFileSync(
    path.join(root, 'supervisor.mjs'),
    compile(readFileSync('src/adapters/process/lifecycle-runner.ts', 'utf8')),
  );
  for (const module of ['executable', 'supervision', 'terminate'])
    writeFileSync(
      path.join(root, module + '.js'),
      compile(readFileSync('src/adapters/process/' + module + '.ts', 'utf8')),
    );
  const controller = path.join(root, 'controller.mjs');
  writeFileSync(
    controller,
    `import {NodeLifecycleRunner} from './supervisor.mjs';
    await new Promise(r=>setTimeout(r,200));
    const output=await new NodeLifecycleRunner().run({vector:[process.execPath,'-e',${JSON.stringify(worker)}],input:Promise.resolve('{}'),timeoutMs:${timeout},role:'foreground'});
    process.stdout.write(output);`,
  );
  return { root, controller, heartbeat };
}

async function loadBridge(
  root: string,
  controller: string,
): Promise<{ callbacks: Map<string, Callback>; messages: unknown[] }> {
  const text = new ExtensionHookProtocol().project({
    current: null,
    owner: 'fx:test',
    event: 'session_start',
    vector: [process.execPath, controller],
    remove: false,
  }).text!;
  const file = path.join(root, 'bridge.mjs');
  writeFileSync(file, compile(text));
  const loaded = await import(/* @vite-ignore */ pathToFileURL(file).href);
  const callbacks = new Map<string, Callback>();
  const messages: unknown[] = [];
  loaded.default({
    on: (event: string, callback: Callback) => callbacks.set(event, callback),
    sendMessage: (message: unknown) => messages.push(message),
  });
  return { callbacks, messages };
}

async function waitForHeartbeat(file: string): Promise<void> {
  for (let i = 0; i < 100 && !existsSync(file); i++) await delay(20);
  expect(existsSync(file)).toBe(true);
}

async function expectStopped(file: string): Promise<void> {
  await delay(100);
  const before = readFileSync(file, 'utf8');
  await delay(150);
  expect(readFileSync(file, 'utf8')).toBe(before);
}

describe('extension and supervisor ownership', () => {
  it('lets the inner two-second deadline reap its worker before the bridge gives up', async () => {
    const f = fixture(2000);
    const bridge = await loadBridge(f.root, f.controller);
    await bridge.callbacks.get('session_start')!({}, { cwd: f.root });
    expect(bridge.messages).toEqual([]);
    await expectStopped(f.heartbeat);
  });

  it('reaps the worker when its supervisor receives termination', async () => {
    const f = fixture(30000);
    const controller = spawn(process.execPath, [f.controller], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    controllers.push(controller);
    await waitForHeartbeat(f.heartbeat);
    const exited = once(controller, 'exit');
    controller.kill('SIGTERM');
    const [code] = await exited;
    expect(code).toBe(0);
    await expectStopped(f.heartbeat);
  });

  it('cancels a pending bridge when its native session is shut down', async () => {
    const f = fixture(30000);
    const bridge = await loadBridge(f.root, f.controller);
    const running = bridge.callbacks.get('session_start')!({}, { cwd: f.root });
    await waitForHeartbeat(f.heartbeat);
    expect(bridge.callbacks.has('session_shutdown')).toBe(true);
    await bridge.callbacks.get('session_shutdown')!({}, { cwd: f.root });
    await running;
    expect(bridge.messages).toEqual([]);
    await expectStopped(f.heartbeat);
  });
});
