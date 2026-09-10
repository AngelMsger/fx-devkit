import path from 'node:path';

import type { TrustedEntry, TrustStore } from '../../src/ports/stores.js';

export class FakeTrustStore implements TrustStore {
  readonly entries: { workspace: string; fingerprint: string; label: string }[] = [];

  async isTrusted(workspace: string, fingerprint: string): Promise<boolean> {
    return this.entries.some((e) => e.workspace === workspace && e.fingerprint === fingerprint);
  }

  async trust(workspace: string, fingerprint: string, label: string): Promise<void> {
    this.entries.push({ workspace, fingerprint, label });
  }

  async list(workspace: string): Promise<TrustedEntry[]> {
    return this.entries
      .filter((e) => e.workspace === workspace)
      .map((e) => ({ fingerprint: e.fingerprint, label: e.label, trusted_at: 'now' }));
  }

  path(): string {
    return path.resolve('/fake/.fx/trust.yaml');
  }
}
