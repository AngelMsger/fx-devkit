// A lease serializes a resource across processes. A bounded unsuccessful
// acquisition is a value, allowing lifecycle callers to skip rather than wait.

export interface LockRequest {
  readonly key: string;
  readonly waitMs: number;
}

export interface Lease {
  release(): Promise<void>;
}

export interface Lock {
  acquire(input: LockRequest): Promise<Lease | null>;
}
