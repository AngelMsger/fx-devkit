// The line at the bottom of a terminal that says fx is still working: what it waits on,
// how far counted work has come and for how long. It is redrawn in place, steps aside
// for everything else that reaches the terminal and leaves nothing behind. While a child
// that can still write to the terminal runs, nothing is redrawn: the line is then said
// as an ordinary one every few seconds, so a question the child asks is never wiped.
// It runs between `start` and `stop`; outside them it lets every write through untouched.

import type { Writable } from 'node:stream';

import type { Activity, Count, Release, Wait } from '../../ports/activity.js';
import type { ProgressEvent } from '../../ports/reporter.js';

import type { Display, LiveLine } from './display.js';
import { humanProgress, humanStatus, type Underway } from './human.js';

// A command that answers sooner than this never shows the line.
const APPEARS_AFTER_MS = 500;
const BEAT_MS = 100;
// How often the line is said while it cannot be redrawn.
const SAID_EVERY_MS = 5000;
const INTERRUPTS = ['SIGINT', 'SIGTERM'] as const;

interface Since {
  readonly name: string;
  readonly since: number;
}

interface Counted {
  readonly count: Count;
  // When each active unit was first seen under way.
  readonly since: ReadonlyMap<string, number>;
}

export function statusLineOn(stream: Writable, display: Display): StatusLine | undefined {
  return display.live && new StatusLine(stream, display, display.live);
}

export class StatusLine implements Activity {
  private readonly counts = new Map<string, Counted>();
  private readonly waits = new Map<symbol, Since & Pick<Wait, 'mayAsk'>>();
  // Steps that began and have not ended, kept in case they must be written down.
  private readonly begun = new Map<string, ProgressEvent>();
  private title = '';
  private startedAt = 0;
  private dueAt = 0;
  private saidAt = 0;
  private tick = 0;
  private handed = 0;
  private drawn = false;
  private halt: Release | undefined;

  constructor(
    private readonly stream: Writable,
    private readonly display: Display,
    private readonly live: LiveLine,
  ) {}

  start(title: string): void {
    this.stop();
    this.title = title;
    this.startedAt = Date.now();
    this.dueAt = this.startedAt + APPEARS_AFTER_MS;
    this.saidAt = this.startedAt;
    const beat = setInterval(() => this.beat(), BEAT_MS);
    // A finished command is never kept alive for the sake of its status line.
    beat.unref();
    const disarm = onInterrupt(() => this.clear());
    this.halt = () => {
      clearInterval(beat);
      disarm();
    };
  }

  stop(): void {
    this.halt?.();
    this.halt = undefined;
    this.clear();
  }

  waiting({ label, mayAsk }: Wait): Release {
    // A question it asks has to find the cursor on a line of its own.
    if (mayAsk) this.clear();
    const key = Symbol(label);
    this.waits.set(key, { name: label, since: Date.now(), mayAsk });
    return () => void this.waits.delete(key);
  }

  // The steps that had begun are written down before the terminal changes hands: they
  // head whatever the person reads there next.
  handover(): Release {
    this.clear();
    const begun = [...this.begun.values()];
    this.begun.clear();
    if (begun.length > 0)
      this.above(begun.map((event) => humanProgress(event, this.display)).join('\n'));
    this.handed += 1;
    let returned = false;
    return () => {
      if (!returned) this.handed -= 1;
      returned = true;
    };
  }

  counted(id: string, count: Count | undefined): void {
    if (count === undefined) {
      this.counts.delete(id);
      return;
    }
    const before = this.counts.get(id)?.since;
    const now = Date.now();
    this.counts.set(id, {
      count,
      since: new Map(count.active.map((name) => [name, before?.get(name) ?? now])),
    });
  }

  // Whether the line speaks for a progress record, which then needs no line of its own.
  // What is under way is the line's to say continuously: a step that begins is held
  // back and a heartbeat is dropped. An outcome is never the line's; it stays on screen.
  takes(event: ProgressEvent): boolean {
    if (this.halt === undefined) return false;
    if (event.state === 'running') return true;
    if (event.state === 'start') this.begun.set(event.id, event);
    else this.begun.delete(event.id);
    return event.state === 'start';
  }

  // Text that stays on the screen goes above the line, which follows it at once: more
  // is likely to come.
  above(text: string): void {
    const cleared = this.drawn ? this.live.redraw('') : '';
    this.stream.write(`${cleared}${text}\n${this.drawn ? this.text() : ''}`);
  }

  // A result on the other stream of the same terminal. It is usually the last thing a
  // command says, so the line waits again before it returns. One that stops short of
  // its line's end leaves the cursor there, where a redraw would wipe what was written,
  // so the line then stays away.
  aside(write: () => void, ended: boolean): void {
    this.clear();
    this.dueAt = ended ? Date.now() + APPEARS_AFTER_MS : Infinity;
    write();
  }

  private beat(): void {
    const now = Date.now();
    if (this.handed > 0 || now < this.dueAt) return;
    this.tick += 1;
    const shared = [...this.waits.values()].some(({ mayAsk }) => mayAsk);
    if (shared && now - this.saidAt < SAID_EVERY_MS) return;
    this.saidAt = now;
    this.drawn = !shared;
    this.stream.write(shared ? `${this.text()}\n` : this.live.redraw(this.text()));
  }

  private clear(): void {
    if (this.drawn) this.stream.write(this.live.redraw(''));
    this.drawn = false;
  }

  private text(): string {
    const now = Date.now();
    const counted = [...this.counts.values()].flatMap(({ since }) =>
      [...since].map(([name, at]): Since => ({ name, since: at })),
    );
    return humanStatus(
      {
        tick: this.tick,
        title: this.title,
        elapsedMs: now - this.startedAt,
        counts: [...this.counts].map(([id, { count }]) => ({ id, ...count })),
        // Counted work names its own units; an external call is named only without them.
        underway: longestFirst(counted.length > 0 ? counted : [...this.waits.values()], now),
      },
      this.display,
      this.live,
    );
  }
}

// One entry per name, by its earliest start.
function longestFirst(running: readonly Since[], now: number): Underway[] {
  const earliest = new Map<string, number>();
  for (const { name, since } of running)
    earliest.set(name, Math.min(earliest.get(name) ?? Infinity, since));
  return [...earliest]
    .map(([name, since]) => ({ name, ms: now - since }))
    .sort((a, b) => b.ms - a.ms);
}

// A line left on the screen after Ctrl-C would read as fx still working. Dying of the
// signal remains the process's to do, unless another listener has taken that on.
function onInterrupt(clear: () => void): Release {
  const disarm = INTERRUPTS.map((signal) => {
    const handler = (): void => {
      clear();
      process.off(signal, handler);
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
    };
    process.on(signal, handler);
    return () => void process.off(signal, handler);
  });
  return () => disarm.forEach((off) => off());
}
