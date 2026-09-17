// In-memory append-only installation evidence for application tests.
import { ToolAudit } from '../../src/application/tool/audit.js';
import type { ToolInstallation } from '../../src/domain/toolchain/installation.js';
import type { ToolHistoryStore } from '../../src/ports/tool-history.js';

import { FakeClock } from './fake-clock.js';

export class FakeToolHistory implements ToolHistoryStore {
  readonly entries: ToolInstallation[] = [];
  async read(): Promise<readonly ToolInstallation[]> {
    return [...this.entries];
  }
  async append(entry: ToolInstallation): Promise<void> {
    this.entries.push(entry);
  }
}
export function fakeToolAudit(store = new FakeToolHistory()): ToolAudit {
  return new ToolAudit(store, new FakeClock());
}
