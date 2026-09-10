// What a use case reports is handed to whatever renders it; the CLI passes
// its Renderer, tests pass a recorder.

import type { Notice, ProgressEvent, Reporter } from '../ports/reporter.js';

export interface ReportSink {
  notice(notice: Notice): void;
  progress(event: ProgressEvent): void;
}

export class SinkReporter implements Reporter {
  constructor(private readonly sink: ReportSink) {}

  notice(notice: Notice): void {
    this.sink.notice(notice);
  }

  progress(event: ProgressEvent): void {
    this.sink.progress(event);
  }
}
