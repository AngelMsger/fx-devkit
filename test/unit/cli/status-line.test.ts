// The status line belongs to a person watching a terminal: it says fx is alive, what it
// waits on and how far it has come, and it never leaves a trace in what stays on screen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { displayOf } from '../../../src/cli/render/display.js';
import { createRenderer } from '../../../src/cli/render/index.js';
import { statusLineOn, type StatusLine } from '../../../src/cli/render/status-line.js';
import { FakeTerminal } from '../../fakes/fake-terminal.js';

// A terminal that draws symbols: every one but the legacy Windows console does.
const SYMBOLS = { env: {}, platform: 'linux' } as const;

// What the terminal shows once every redraw has been applied: the lines that stayed,
// then whatever is on the last line.
function screen(terminal: FakeTerminal): string[] {
  const lines = [''];
  for (const part of terminal.text().split(/(\r|\n|\u001b\[K)/)) {
    if (part === '\n') lines.push('');
    else if (part === '\r') lines[lines.length - 1] = '';
    else if (part !== '\u001b[K') lines[lines.length - 1] += part;
  }
  return lines;
}

function watched(columns = 100): { terminal: FakeTerminal; status: StatusLine } {
  const terminal = new FakeTerminal(columns, false);
  return { terminal, status: statusLineOn(terminal, displayOf(terminal, {}, 'darwin'))! };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a status line', () => {
  it('exists only where a line can be redrawn', () => {
    const dumb = new FakeTerminal();
    expect(statusLineOn(dumb, displayOf(dumb, { TERM: 'dumb' }, 'darwin'))).toBeUndefined();
    for (const format of ['json', 'ndjson'] as const)
      expect(
        createRenderer(format, { out: new FakeTerminal(), err: new FakeTerminal() }).status,
      ).toBeUndefined();
    const io = { out: new FakeTerminal(), err: new FakeTerminal(), env: {} };
    expect(createRenderer('human', io, { quiet: true }).status).toBeUndefined();
    expect(createRenderer('human', io).status).toBeDefined();
  });

  it('stays away from a command that answers at once and leaves nothing when it ends', () => {
    const { terminal, status } = watched();
    status.start('status');
    vi.advanceTimersByTime(400);
    status.stop();
    expect(terminal.text()).toBe('');

    status.start('doctor');
    vi.advanceTimersByTime(700);
    expect(screen(terminal)).toEqual([expect.stringMatching(/^. doctor$/)]);
    status.stop();
    expect(screen(terminal)).toEqual(['']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('names nothing that has only just begun: that is not yet what a person waits on', () => {
    const { terminal, status } = watched();
    status.start('status');
    vi.advanceTimersByTime(600);
    status.counted('repos', { total: 60, completed: 12, active: ['api', 'web'] });
    status.waiting({ label: 'logs version probe', mayAsk: false });
    vi.advanceTimersByTime(300);
    expect(screen(terminal).at(-1)).toMatch(/^. status {2}repos 12\/60$/);
    status.stop();
  });

  it('says how far counted work has come and what has been under way the longest', () => {
    const { terminal, status } = watched();
    status.start('doctor');
    status.counted('checks', { total: 82, completed: 68, active: ['cluster.access@dev'] });
    vi.advanceTimersByTime(12_000);
    status.counted('checks', {
      total: 82,
      completed: 69,
      active: ['cluster.access@dev', 'logs.access@test'],
    });
    vi.advanceTimersByTime(3_000);
    expect(screen(terminal).at(-1)).toMatch(
      /^. doctor 15s {2}checks 69\/82 {2}cluster\.access@dev 15s, logs\.access@test 3s$/,
    );
    status.counted('checks', undefined);
    vi.advanceTimersByTime(100);
    expect(screen(terminal).at(-1)).toMatch(/^. doctor 15s$/);
    status.stop();
  });

  it('names the external call it waits on when nothing is counted', () => {
    const { terminal, status } = watched();
    status.start('where');
    const done = status.waiting({ label: 'cluster coordinate probe', mayAsk: false });
    vi.advanceTimersByTime(2_000);
    expect(screen(terminal).at(-1)).toMatch(/^. where 2s {2}cluster coordinate probe 2s$/);
    done();
    vi.advanceTimersByTime(100);
    expect(screen(terminal).at(-1)).toMatch(/^. where 2s$/);
    status.stop();
  });

  it('redraws nothing under a call that can still ask on the terminal, and says so in lines', () => {
    const { terminal, status } = watched();
    status.start('sync');
    status.counted('repos', { phase: 'apply', total: 8, completed: 3, active: ['api'] });
    vi.advanceTimersByTime(600);
    expect(screen(terminal)).toEqual([expect.stringMatching(/^. sync {2}repos apply 3\/8$/)]);

    // The line is gone before the call starts, so its question gets a line of its own.
    const fetched = status.waiting({ label: 'git', mayAsk: true });
    expect(screen(terminal)).toEqual(['']);
    terminal.write('Are you sure you want to continue connecting (yes/no)? ');
    vi.advanceTimersByTime(4_000);
    expect(screen(terminal)).toEqual(['Are you sure you want to continue connecting (yes/no)? ']);

    // After five seconds without a word, the line is said after whatever is there.
    terminal.write('yes\n');
    vi.advanceTimersByTime(1_000);
    expect(screen(terminal)).toEqual([
      'Are you sure you want to continue connecting (yes/no)? yes',
      expect.stringMatching(/^. sync 5s {2}repos apply 3\/8 {2}api 5s$/),
      '',
    ]);
    vi.advanceTimersByTime(4_900);
    expect(screen(terminal)).toHaveLength(3);

    fetched();
    vi.advanceTimersByTime(100);
    expect(screen(terminal).at(-1)).toMatch(/^. sync 10s {2}repos apply 3\/8 {2}api 10s$/);
    status.stop();
    expect(screen(terminal)).toHaveLength(3);
  });

  it('never wraps: a line that did could not be taken back', () => {
    const { terminal, status } = watched(40);
    status.start('doctor');
    status.counted('checks', {
      total: 82,
      completed: 3,
      active: ['a-rather-long-check-name@production', 'another@test'],
    });
    vi.advanceTimersByTime(2_000);
    const line = screen(terminal).at(-1)!;
    expect(line.length).toBeLessThanOrEqual(39);
    expect(line.endsWith('…')).toBe(true);
    status.stop();
  });

  it('keeps what stays on screen above it and follows at once', () => {
    const { terminal, status } = watched();
    status.start('sync');
    vi.advanceTimersByTime(600);
    status.above('api  done  fast_forward');
    expect(screen(terminal)).toEqual([
      'api  done  fast_forward',
      expect.stringMatching(/^. sync$/),
    ]);
    status.stop();
    expect(screen(terminal)).toEqual(['api  done  fast_forward', '']);
  });

  it('steps aside for a result and waits again before it returns', () => {
    const { terminal, status } = watched();
    status.start('doctor');
    vi.advanceTimersByTime(600);
    status.aside(() => terminal.write('ready\n'), true);
    expect(screen(terminal)).toEqual(['ready', '']);
    vi.advanceTimersByTime(400);
    expect(screen(terminal)).toEqual(['ready', '']);
    vi.advanceTimersByTime(200);
    expect(screen(terminal).at(-1)).toMatch(/^. doctor 1s$/);
    status.stop();
  });

  it('stays away from a result that stopped short of the end of its line', () => {
    const terminal = new FakeTerminal(100, false);
    const renderer = createRenderer('human', { out: terminal, err: terminal, ...SYMBOLS });
    renderer.status!.start('manifest schema');
    vi.advanceTimersByTime(600);
    renderer.text('{ "type": "object" }');
    vi.advanceTimersByTime(5_000);
    expect(screen(terminal)).toEqual(['{ "type": "object" }']);
    renderer.status!.stop();
  });

  it('hands the terminal over, with the steps that had begun written down first', () => {
    const terminal = new FakeTerminal(100, false);
    const renderer = createRenderer('human', {
      out: new FakeTerminal(),
      err: terminal,
      ...SYMBOLS,
    });
    const status = renderer.status!;
    status.start('login');
    vi.advanceTimersByTime(600);
    renderer.progress({ id: 'logs.login', state: 'start', detail: 'logs auth login' });
    expect(screen(terminal)).toEqual([expect.stringMatching(/^. login$/)]);

    const returned = status.handover();
    expect(screen(terminal)).toEqual([`  ${'logs.login'.padEnd(24)} start  logs auth login`, '']);
    vi.advanceTimersByTime(5_000);
    expect(screen(terminal).at(-1)).toBe('');

    returned();
    vi.advanceTimersByTime(100);
    expect(screen(terminal).at(-1)).toMatch(/^. login 5s$/);
    status.stop();
  });

  it('speaks for what is under way and leaves every outcome on screen', () => {
    const terminal = new FakeTerminal(100, false);
    const renderer = createRenderer('human', {
      out: new FakeTerminal(),
      err: terminal,
      ...SYMBOLS,
    });
    renderer.status!.start('sync');
    renderer.progress({ id: 'api', state: 'start', detail: 'fast_forward' });
    renderer.progress({ id: 'repos', state: 'running', total: 2, completed: 0 });
    expect(terminal.text()).toBe('');
    renderer.progress({ id: 'api', state: 'done', detail: 'fast_forward' });
    renderer.progress({ id: 'web', state: 'fail', detail: 'unreachable' });
    expect(screen(terminal)).toEqual([
      `✓ ${'api'.padEnd(24)} done  fast_forward`,
      `✗ ${'web'.padEnd(24)} fail  unreachable`,
      '',
    ]);
    renderer.status!.stop();
    // Nothing had to be written down: the step that began also ended.
    renderer.status!.handover();
    expect(screen(terminal)).toHaveLength(3);
  });

  it('lets every record through as a line while it is not running', () => {
    const terminal = new FakeTerminal(100, false);
    const renderer = createRenderer('human', {
      out: new FakeTerminal(),
      err: terminal,
      ...SYMBOLS,
    });
    renderer.progress({ id: 'api', state: 'start', detail: 'clone' });
    expect(screen(terminal)).toEqual([`  ${'api'.padEnd(24)} start  clone`, '']);
  });
});
