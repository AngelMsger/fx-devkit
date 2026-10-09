// The only way anything in fx starts a subprocess. Vectors go straight to
// the executable as arguments. Windows batch shims require an adapter-owned
// interpreter with escaping; callers cannot request raw shell evaluation.

export interface ProcessResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  // The executable could not be started. `code` is then the 127 a shell reports, which a
  // program that did start may exit with as well, so only this says which it was.
  readonly notStarted?: true;
}

export interface ProcessDiagnosticContext {
  readonly phase: string;
  readonly capability?: string;
  readonly provider?: string;
  readonly binding?: string;
}

export interface RunOptions {
  readonly cwd?: string | undefined;
  // Added to the environment fx itself runs in, never replacing it: a child
  // that loses PATH cannot find the tool it is.
  readonly env?: NodeJS.ProcessEnv | undefined;
  // When to give up: the child (with its process group, on POSIX) is killed
  // then; the answer follows once it has closed, or half a second later.
  readonly timeoutMs?: number | undefined;
  readonly input?: string | undefined;
  readonly sensitiveOutput?: boolean | undefined;
  // The child owns the terminal (a login prompt); only the exit code comes back.
  readonly interactive?: boolean | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly diagnostic?: ProcessDiagnosticContext | undefined;
}

export interface Process {
  run(vector: readonly string[], options?: RunOptions): Promise<ProcessResult>;
  which(binary: string, options?: Pick<RunOptions, 'cwd' | 'env'>): Promise<string | undefined>;
}
