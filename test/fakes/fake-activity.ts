import type { Activity, Count, Release, Wait } from '../../src/ports/activity.js';

// Keeps what a watcher would have been told, in the order it was said.
export class FakeActivity implements Activity {
  readonly waits: Wait[] = [];
  readonly counts: { readonly id: string; readonly count: Count | undefined }[] = [];
  // How many holders have the terminal right now.
  handed = 0;
  handovers = 0;

  waiting(wait: Wait): Release {
    this.waits.push(wait);
    return () => undefined;
  }

  handover(): Release {
    this.handed += 1;
    this.handovers += 1;
    return () => {
      this.handed -= 1;
    };
  }

  counted(id: string, count: Count | undefined): void {
    this.counts.push({ id, count });
  }

  // The counts reported for one piece of work, without the closing `undefined`.
  of(id: string): Count[] {
    return this.counts.flatMap((entry) =>
      entry.id === id && entry.count !== undefined ? [entry.count] : [],
    );
  }
}
