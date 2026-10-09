// A command-scoped activity channel lets composition wire the process port and the
// prompter before CLI initialization knows whether anyone is watching. Until a watcher
// is connected, and wherever none ever is, what is said here goes nowhere.

import type { Activity, Count, Release, Wait } from '../ports/activity.js';

const RELEASED: Release = () => undefined;

export class ActivityChannel implements Activity {
  private watcher: Activity | undefined;

  connect(watcher: Activity): void {
    this.watcher = watcher;
  }

  waiting(wait: Wait): Release {
    return this.watcher?.waiting(wait) ?? RELEASED;
  }

  handover(): Release {
    return this.watcher?.handover() ?? RELEASED;
  }

  counted(id: string, count: Count | undefined): void {
    this.watcher?.counted(id, count);
  }
}
