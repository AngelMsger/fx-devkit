// Supervised lifecycle workers return only a complete bounded payload.
// A failed worker is an empty answer rather than a failed host session.

export interface LifecycleRun {
  readonly vector: readonly string[];
  readonly input: Promise<string>;
  readonly timeoutMs: number;
  readonly env?: NodeJS.ProcessEnv;
}

export interface LifecycleRunner {
  run(input: LifecycleRun): Promise<string>;
}
