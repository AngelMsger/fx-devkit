// Opening a URL is a desktop effect, independent of repository lookup.

import type { Process } from '../../ports/process.js';

import { powershellVector } from './powershell.js';

export class SystemUrlOpener {
  constructor(
    private readonly process: Process,
    private readonly platform = globalThis.process.platform,
  ) {}

  async open(url: string): Promise<boolean> {
    try {
      const vector =
        this.platform === 'win32'
          ? powershellVector(
              "$ErrorActionPreference='Stop'; Start-Process -FilePath $env:FX_OPEN_URL",
            )
          : [this.platform === 'darwin' ? 'open' : 'xdg-open', url];
      const result = await this.process.run(vector, { env: { FX_OPEN_URL: url }, timeoutMs: 3000 });
      return result.code === 0;
    } catch {
      return false;
    }
  }
}
