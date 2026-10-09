// Counts the units of one piece of work for whoever watches it: how many are planned,
// how many are finished and which are under way. A workflow that also owes programs a
// record of its progress reads the same count instead of keeping a second one.

import type { Activity, Count } from '../ports/activity.js';

export class Tally {
  private phase: string | undefined;
  private total = 0;
  private completed = 0;
  private readonly active = new Set<string>();
  private over = false;

  private constructor(
    private readonly activity: Activity,
    private readonly id: string,
  ) {}

  // Counts `work` under `id`. The count ends with the work, however that ends: a unit
  // still running after its siblings failed has nothing left to report to.
  static async during<T>(
    activity: Activity,
    id: string,
    work: (tally: Tally) => Promise<T>,
  ): Promise<T> {
    const tally = new Tally(activity, id);
    try {
      return await work(tally);
    } finally {
      tally.over = true;
      activity.counted(id, undefined);
    }
  }

  get count(): Count {
    return {
      phase: this.phase,
      total: this.total,
      completed: this.completed,
      active: [...this.active],
    };
  }

  // A workflow that makes several passes over its units counts each pass from zero.
  enter(phase: string): this {
    this.phase = phase;
    this.total = 0;
    this.completed = 0;
    return this.tell();
  }

  // Announces units before they start, so the total is right from the first one.
  plan(units: number): this {
    this.total += units;
    return this.tell();
  }

  async unit<T>(name: string, work: () => Promise<T>): Promise<T> {
    this.active.add(name);
    this.tell();
    try {
      return await work();
    } finally {
      this.active.delete(name);
      this.completed += 1;
      this.tell();
    }
  }

  private tell(): this {
    if (!this.over) this.activity.counted(this.id, this.count);
    return this;
  }
}
