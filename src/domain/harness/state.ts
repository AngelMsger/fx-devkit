// Hook receipts describe ownership, not user configuration. Observations are
// dated evidence and never substitute for a current readiness check.

export interface HookReceipt {
  readonly agent: string;
  readonly relative: string;
  readonly owner: string;
  readonly created: boolean;
}

export interface HookObservation {
  readonly checkedAt: number;
  readonly phase: string;
  readonly code: string;
  readonly command: string | null;
}

export interface HookState {
  readonly root: string;
  readonly receipts: readonly HookReceipt[];
  readonly lastAttempt: number | null;
  readonly lastRefresh: number | null;
  readonly observations: readonly HookObservation[];
}
