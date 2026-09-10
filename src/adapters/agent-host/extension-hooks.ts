// Project extensions bridge a native lifecycle event to the same fx process
// entry. A content digest protects a bridge somebody edited after projection.

import { createHash } from 'node:crypto';

import type { HookInvocation, HookSupport } from '../../domain/harness/hooks.js';
import type {
  HookProjection,
  HookProjectionInput,
  HookProtocol,
} from '../../ports/hook-protocol.js';

export class ExtensionHookProtocol implements HookProtocol {
  project(input: HookProjectionInput): HookProjection {
    if (input.current !== null && !isOwned(input.current, input.owner))
      return { text: input.current, status: 'foreign' };
    if (input.remove) return { text: null, status: 'managed' };
    const body = renderBridge(input);
    return { text: `${body}// fx:content ${digest(body)}\n`, status: 'managed' };
  }

  context(text: string, _support: HookSupport): string {
    return text ? JSON.stringify({ context: text }) : '';
  }

  decode(text: string, _support: HookSupport): HookInvocation | null {
    try {
      const input: unknown = JSON.parse(text);
      if (
        typeof input !== 'object' ||
        input === null ||
        !('cwd' in input) ||
        typeof input.cwd !== 'string'
      )
        return null;
      return { cwd: input.cwd, sessionId: null };
    } catch {
      return null;
    }
  }
}

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function isOwned(text: string, owner: string): boolean {
  const at = text.lastIndexOf('// fx:content ');
  return (
    text.startsWith(`// fx:derived ${owner}\n`) &&
    at >= 0 &&
    text.slice(at).trim() === `// fx:content ${digest(text.slice(0, at))}`
  );
}

function renderBridge(input: HookProjectionInput): string {
  return `// fx:derived ${input.owner}
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
const vector: string[] = ${JSON.stringify([...input.vector, '--owner', input.owner])};
const event = ${JSON.stringify(input.event)};
${BRIDGE_PROGRAM}`;
}

const BRIDGE_PROGRAM = `interface Host {
  on(event: string, handler: (event: unknown, context: { cwd: string }) => Promise<void>): void;
  sendMessage(message: { customType: string; content: string; display: boolean }, options: { triggerTurn: boolean }): void;
}
export default function register(host: Host): void {
  const pending = new Set<() => void>();
  host.on('session_shutdown', async () => {
    for (const cancel of [...pending]) cancel();
  });
  host.on(event, async (_event, context) => {
    try { await run(host, context.cwd, pending); }
    catch { /* A lifecycle failure must not fail the host session. */ }
  });
}
function run(host: Host, cwd: string, pending: Set<() => void>): Promise<void> {
  return new Promise<void>((resolve) => {
    const child = spawn(vector[0]!, vector.slice(1), {
      cwd, stdio: ['pipe', 'pipe', 'ignore'], detached: process.platform !== 'win32', windowsHide: true,
    });
    let output = '';
    let done = false;
    let force: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      pending.delete(cancel);
      resolve();
    };
    const cancel = (): void => {
      if (done) return;
      output = '';
      signal(child, 'SIGTERM');
      force = setTimeout(() => signal(child, 'SIGKILL'), 250);
      finish();
    };
    const timer = setTimeout(cancel, 3000);
    pending.add(cancel);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (done) return;
      output += chunk.toString();
      if (Buffer.byteLength(output) > 8192) cancel();
    });
    child.on('error', finish);
    child.on('close', code => {
      clearTimeout(force);
      if (!done && code === 0) deliver(host, output);
      finish();
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ cwd }));
  });
}
function signal(child: ChildProcess, name: 'SIGTERM' | 'SIGKILL'): void {
  try {
    if (process.platform !== 'win32' && child.pid !== undefined) process.kill(-child.pid, name);
    else {
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        const executable = path.join(process.env.SystemRoot ?? 'C:\\\\Windows', 'System32', 'taskkill.exe');
        const result = spawnSync(executable, ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 500 });
        if (result.status === 0) return;
      }
      child.kill(name);
    }
  } catch { child.kill(name); }
}
function deliver(host: Host, output: string): void {
  try {
    const result: unknown = JSON.parse(output);
    if (typeof result === 'object' && result !== null && 'context' in result && typeof result.context === 'string')
      host.sendMessage({ customType: 'fx-workspace', content: result.context, display: false }, { triggerTurn: false });
  } catch { /* Invalid or late context is discarded. */ }
}
`;
