// Format-independent workflow notices and progress events.

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
  readonly phase?: string;
  readonly total?: number;
  readonly completed?: number;
  readonly elapsed_ms?: number;
  readonly active?: readonly string[];
}

export interface Reporter {
  notice(notice: Notice): void;
  progress(event: ProgressEvent): void;
}
