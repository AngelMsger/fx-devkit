import type { LocalLayer } from '../../src/domain/manifest/types.js';
import type { LocalLayerStore } from '../../src/ports/stores.js';

export class FakeLocalStore implements LocalLayerStore {
  private readonly pending = new Map<string, Promise<void>>();
  readonly writes: { workspace: string; layer: LocalLayer }[] = [];

  constructor(private readonly layers: Map<string, LocalLayer> = new Map()) {}

  static with(workspace: string, layer: LocalLayer): FakeLocalStore {
    return new FakeLocalStore(new Map([[workspace, layer]]));
  }

  async read(workspace: string): Promise<LocalLayer> {
    return structuredClone(this.layers.get(workspace) ?? {});
  }

  async write(workspace: string, next: LocalLayer): Promise<void> {
    await this.update(workspace, () => next);
  }

  async update(
    workspace: string,
    change: (current: LocalLayer) => LocalLayer | Promise<LocalLayer>,
  ): Promise<LocalLayer> {
    const previous = this.pending.get(workspace) ?? Promise.resolve();
    let release = (): void => undefined;
    this.pending.set(
      workspace,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    await previous;
    try {
      const next = await change(await this.read(workspace));
      this.layers.set(workspace, structuredClone(next));
      this.writes.push({ workspace, layer: structuredClone(next) });
      return structuredClone(next);
    } finally {
      release();
    }
  }

  path(workspace: string): string {
    return `/fake/.fx/workspaces/${workspace}/local.yaml`;
  }
}
