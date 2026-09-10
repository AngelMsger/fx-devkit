// Workspace ownership metadata excludes configuration bodies and secret values.

export interface HarnessReceipt {
  readonly key: string;
  readonly kind: 'mcp' | 'rules';
  readonly relative: string;
  readonly protocol: string;
  readonly name: string;
  readonly agents: readonly string[];
  readonly digest: string;
  readonly created: boolean;
}
export interface HarnessIntent {
  readonly key: string;
  readonly relative: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly receipt: HarnessReceipt | null;
}
export interface HarnessState {
  readonly root: string;
  readonly receipts: readonly HarnessReceipt[];
  readonly pending: HarnessIntent | null;
}
