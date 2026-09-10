import type { LocalLayer } from '../../src/domain/manifest/types.js';
import type { LocalLayerStore } from '../../src/ports/stores.js';

export class FakeLocalStore implements LocalLayerStore {
  readonly writes: { workspace: string; layer: LocalLayer }[] = [];

  constructor(private readonly layers: Map<string, LocalLayer> = new Map()) {}

  static with(workspace: string, layer: LocalLayer): FakeLocalStore {
    return new FakeLocalStore(new Map([[workspace, layer]]));
  }

  async read(workspace: string): Promise<LocalLayer> {
    return structuredClone(this.layers.get(workspace) ?? {});
  }

  async write(workspace: string, next: LocalLayer): Promise<void> {
    this.layers.set(workspace, structuredClone(next));
    this.writes.push({ workspace, layer: structuredClone(next) });
  }

  path(workspace: string): string {
    return `/fake/.fx/workspaces/${workspace}/local.yaml`;
  }
}
