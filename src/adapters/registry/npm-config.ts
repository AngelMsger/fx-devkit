// Resolve the same user/global registry configuration npm uses for a global
// installation. A workspace's .npmrc cannot redirect fx's own package updates.
import type { Process } from '../../ports/process.js';
import type { RegistryLocation, RegistryLocator } from '../../ports/registry.js';

import { runtimeRegistry } from './registry-policy.js';

export class NpmRegistryLocator implements RegistryLocator {
  private readonly locations = new Map<string, Promise<RegistryLocation>>();

  constructor(
    private readonly process: Pick<Process, 'run'>,
    private readonly env: NodeJS.ProcessEnv,
    private readonly userHome: string,
  ) {}

  resolve(packageName: string): Promise<RegistryLocation> {
    let location = this.locations.get(packageName);
    if (!location) {
      location = this.read(packageName);
      this.locations.set(packageName, location);
    }
    return location;
  }

  private async read(packageName: string): Promise<RegistryLocation> {
    if (this.env.FX_REGISTRY !== undefined)
      return {
        registry: runtimeRegistry(this.env.FX_REGISTRY),
        source: 'environment',
      };
    const scope = packageName.split('/')[0]!;
    const key = `${scope}:registry`;
    try {
      const result = await this.process.run(
        ['npm', 'config', 'get', key, 'registry', '--global', '--update-notifier=false'],
        {
          cwd: this.userHome,
          env: this.env,
          timeoutMs: 2000,
          sensitiveOutput: true,
          diagnostic: { phase: 'npm registry configuration' },
        },
      );
      if (result.code === 0) {
        const lines = result.stdout.trim().split(/\r?\n/);
        if (
          lines.length !== 2 ||
          !lines.some((line) => line.startsWith(`${key}=`)) ||
          !lines.some((line) => line.startsWith('registry='))
        )
          return { registry: null, source: 'unavailable' };
        const value = (name: string): string | undefined => {
          const line = lines.find((item) => item.startsWith(`${name}=`));
          const configured = line?.slice(name.length + 1).trim();
          return configured === undefined || configured === 'undefined' ? undefined : configured;
        };
        const scoped = value(key);
        if (scoped !== undefined) return { registry: runtimeRegistry(scoped), source: 'npm_scope' };
        const registry = value('registry');
        if (registry !== undefined)
          return { registry: runtimeRegistry(registry), source: 'npm_default' };
      }
    } catch {
      // Startup and configuration failures must not break unrelated fx commands.
    }
    const registry = runtimeRegistry(undefined);
    return { registry, source: registry === null ? 'unavailable' : 'distribution_default' };
  }
}
