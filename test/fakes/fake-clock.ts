import type { Clock } from '../../src/ports/clock.js';

export class FakeClock implements Clock {
  constructor(private current: Date = new Date('2026-09-01T00:00:00Z')) {}

  now(): Date {
    return this.current;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
