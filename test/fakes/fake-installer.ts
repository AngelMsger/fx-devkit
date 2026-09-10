import { BrewInstaller } from '../../src/adapters/installer/brew.js';
import { GoInstaller } from '../../src/adapters/installer/go.js';
import { ManualInstaller } from '../../src/adapters/installer/manual.js';
import { NpmInstaller } from '../../src/adapters/installer/npm.js';
import type { Installer, InstallerId } from '../../src/ports/installer.js';

// The real vector builders with scripted availability.
export class FakeInstaller implements Installer {
  constructor(
    private readonly inner: Installer,
    private readonly present: boolean,
  ) {}

  get id(): InstallerId {
    return this.inner.id;
  }

  async available(): Promise<boolean> {
    return this.present;
  }

  vector(
    spec: string,
    opts: { registry?: string | undefined; update: boolean },
  ): readonly string[] | undefined {
    return this.inner.vector(spec, opts);
  }

  static family(available: readonly string[]): Installer[] {
    const none = {
      which: async () => undefined,
      run: async () => ({ code: 0, stdout: '', stderr: '' }),
    };
    return [
      new NpmInstaller(none),
      new BrewInstaller(none),
      new GoInstaller(none),
      new ManualInstaller(),
    ].map(
      (inner) => new FakeInstaller(inner, inner.id === 'manual' || available.includes(inner.id)),
    );
  }
}
