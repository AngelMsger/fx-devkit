// Decode a companion's public service plan without exposing its response format
// to preparation workflows. Only approved public changes cross this boundary.

export type ServiceChanges = Readonly<
  Record<string, { readonly before: string; readonly after: string }>
>;

export type ServicePlan =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'unreadable' }
  | {
      readonly kind: 'changes';
      readonly createsContext: boolean;
      readonly changes: ServiceChanges;
    };

export interface ServiceFailure {
  readonly kind: 'conflict' | 'managed_session' | 'unknown';
  readonly code: string | null;
  readonly changes: ServiceChanges;
}

export interface ServiceProtocol {
  plan(stdout: string): ServicePlan;
  failure(stderr: string): ServiceFailure;
}
