// How a use case talks to the outside while it runs. It knows nothing about
// formats: the CLI decides whether a progress event becomes a line, a bar or
// an ndjson record.

export interface Notice {
  readonly code: string;
  readonly message: string;
  readonly nextSteps?: readonly string[];
  readonly silence?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface ProgressEvent {
  readonly id: string;
  readonly state: 'start' | 'running' | 'done' | 'skip' | 'fail';
  readonly detail?: string;
  readonly total?: number;
  readonly completed?: number;
  readonly elapsed_ms?: number;
  readonly active?: readonly string[];
}

export interface Reporter {
  notice(notice: Notice): void;
  progress(event: ProgressEvent): void;
}
