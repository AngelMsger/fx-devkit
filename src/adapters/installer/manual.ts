// A tool installed by hand has no vector; the person gets the docs instead.

import type { Installer } from '../../ports/installer.js';

export class ManualInstaller implements Installer {
  readonly id = 'manual';

  async available(): Promise<boolean> {
    return true;
  }

  vector(): undefined {
    return undefined;
  }
}
