// Supervised lifecycle workers return only a complete bounded payload.
// A failed worker is an empty answer rather than a failed host session.

// A foreground run has a host waiting on its single answer; a background run
// has nobody waiting, so one companion command is not the whole run.
export type LifecycleRole = 'foreground' | 'background';

export interface LifecycleRun {
  readonly vector: readonly string[];
  readonly input: Promise<string>;
  readonly timeoutMs: number;
  readonly role: LifecycleRole;
  readonly env?: NodeJS.ProcessEnv;
}

export interface LifecycleRunner {
  run(input: LifecycleRun): Promise<string>;
}
