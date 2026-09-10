import type { Notice, ProgressEvent, Reporter } from '../../src/ports/reporter.js';

export class FakeReporter implements Reporter {
  readonly notices: Notice[] = [];
  readonly progress_: ProgressEvent[] = [];

  notice(notice: Notice): void {
    this.notices.push(notice);
  }

  progress(event: ProgressEvent): void {
    this.progress_.push(event);
  }

  codes(): string[] {
    return this.notices.map((n) => n.code);
  }
}
