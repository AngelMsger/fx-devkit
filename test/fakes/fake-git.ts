import path from 'node:path';

import type { RepoState } from '../../src/domain/workspace/state.js';
import type { CloneRequest, FastForwardOutcome, Git, RemoteHead } from '../../src/ports/git.js';

export interface FakeCheckout {
  state: RepoState;
  remotes: Record<string, string>;
  fastForward?: FastForwardOutcome;
  remoteHeads?: Record<string, string>;
  liveHeads?: Record<string, RemoteHead | undefined>;
  shas?: Record<string, string>;
}

type Before = {
  [K in keyof Git]?: (...args: Parameters<FakeGit[K]>) => void | Promise<void>;
};

// In-memory git: checkouts are entries in a map; every mutating call is
// recorded so a test can assert what was (not) done.
export class FakeGit implements Git {
  readonly checkouts = new Map<string, FakeCheckout>();
  readonly calls: string[] = [];
  private readonly hooks: Before = {};

  constructor(private readonly onCheckout: (dir: string) => void = () => undefined) {}

  // Runs ahead of one operation, which neither records nor acts when the hook throws:
  // a case fails the operation with the error git would raise, or holds it open.
  before<K extends keyof Git>(operation: K, hook: NonNullable<Before[K]>): this {
    this.hooks[operation] = hook;
    return this;
  }

  add(dir: string, checkout: Partial<FakeCheckout> & { remotes?: Record<string, string> }): this {
    this.onCheckout(dir);
    this.checkouts.set(path.resolve(dir), {
      state: { branch: 'dev', dirty: false, untracked: 0, ahead: 0, behind: 0 },
      remotes: {},
      ...checkout,
    });
    return this;
  }

  async clone(req: CloneRequest): Promise<void> {
    await this.hooks.clone?.(req);
    this.calls.push(`clone ${req.dir}`);
    const remotes: Record<string, string> = { upstream: req.upstream };
    if (req.origin !== undefined) remotes['origin'] = req.origin;
    this.add(req.dir, {
      remotes,
      state: { branch: req.branch, dirty: false, untracked: 0, ahead: 0, behind: 0 },
    });
  }

  async fetch(dir: string, remote: string): Promise<void> {
    await this.hooks.fetch?.(dir, remote);
    this.calls.push(`fetch ${dir} ${remote}`);
  }

  async fastForward(dir: string, remote: string, branch: string): Promise<FastForwardOutcome> {
    await this.hooks.fastForward?.(dir, remote, branch);
    this.calls.push(`fast-forward ${dir} ${remote}/${branch}`);
    return this.checkouts.get(path.resolve(dir))?.fastForward ?? 'up_to_date';
  }

  async status(dir: string): Promise<RepoState> {
    await this.hooks.status?.(dir);
    const checkout = this.checkouts.get(path.resolve(dir));
    if (checkout === undefined) throw new Error(`fake git: ${dir} is not a checkout`);
    return checkout.state;
  }

  async toplevel(dir: string): Promise<string | undefined> {
    await this.hooks.toplevel?.(dir);
    return this.checkouts.has(path.resolve(dir)) ? dir : undefined;
  }

  async isToplevel(dir: string): Promise<boolean> {
    await this.hooks.isToplevel?.(dir);
    return this.checkouts.has(path.resolve(dir));
  }

  async remotes(dir: string): Promise<Record<string, string>> {
    await this.hooks.remotes?.(dir);
    return this.checkouts.get(path.resolve(dir))?.remotes ?? {};
  }

  async remoteHead(dir: string, remote: string): Promise<string | undefined> {
    await this.hooks.remoteHead?.(dir, remote);
    return this.checkouts.get(path.resolve(dir))?.remoteHeads?.[remote];
  }

  async askRemoteHead(dir: string, remote: string): Promise<RemoteHead | undefined> {
    await this.hooks.askRemoteHead?.(dir, remote);
    this.calls.push(`ls-remote ${dir} ${remote}`);
    return this.checkouts.get(path.resolve(dir))?.liveHeads?.[remote];
  }

  async sha(dir: string, ref: string): Promise<string | undefined> {
    await this.hooks.sha?.(dir, ref);
    return this.checkouts.get(path.resolve(dir))?.shas?.[ref];
  }

  async addRemote(dir: string, name: string, url: string): Promise<void> {
    await this.hooks.addRemote?.(dir, name, url);
    this.calls.push(`remote add ${dir} ${name} ${url}`);
    const checkout = this.checkouts.get(path.resolve(dir));
    if (checkout !== undefined) checkout.remotes[name] = url;
  }
}
