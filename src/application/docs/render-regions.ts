// Rendering the generated regions of AGENTS.md (and the CLAUDE.md pointer)
// inside a manifest directory — a checkout of the manifest repository, for
// its maintainers and its CI. Prose outside the regions is never touched; a
// draft may go to another path so it can be looked at without touching
// anything.

import path from 'node:path';

import { renderRegions } from '../../domain/docs/regions.js';
import { agentsSkeleton, CLAUDE_POINTER } from '../../domain/docs/skeleton.js';
import { renderAll } from '../../domain/docs/templates.js';
import type { FileSystem } from '../../ports/fs.js';
import type { Reporter } from '../../ports/reporter.js';
import type { LoginDeps } from '../login/deps.js';
import type { ManifestContext } from '../manifest/context.js';

import {
  actionFor,
  finish,
  pending,
  reportRegions,
  type Pending,
  type RenderInput,
  type RenderOutput,
} from './rendered.js';
import { templateInputOf } from './template.js';

export interface RenderRegionsDeps extends Pick<LoginDeps, 'describeProvider'> {
  readonly fs: FileSystem;
  readonly reporter: Reporter;
  readonly context: ManifestContext;
}

export class RenderRegions {
  constructor(private readonly deps: RenderRegionsDeps) {}

  async execute(input: RenderInput): Promise<RenderOutput> {
    const agents = await this.agents(input.out);
    const files = [agents];
    if (input.out === undefined) files.push(await this.claude());
    if (agents.file.action === 'created')
      this.deps.reporter.notice({
        code: 'DOCS_CREATED',
        message: `${agents.file.path} did not exist; a skeleton with every region was written`,
      });
    reportRegions(this.deps.reporter, agents.file.path, agents.file);
    return finish(this.deps.fs, input, files);
  }

  private async agents(out: string | undefined): Promise<Pending> {
    const source = path.join(this.deps.context.dir, 'AGENTS.md');
    const target = out ?? source;
    // A draft written elsewhere is always fresh: the skeleton, fully rendered.
    const existing = out === undefined ? await this.deps.fs.readText(source) : undefined;
    const base = existing ?? agentsSkeleton(path.basename(this.deps.context.dir));
    const rendered = renderRegions(
      base,
      renderAll(await templateInputOf(this.deps.context, this.deps, this.deps.fs)),
    );
    const current = out === undefined ? existing : await this.deps.fs.readText(target);
    return pending(target, actionFor(current, rendered.text), rendered.text, rendered);
  }

  private async claude(): Promise<Pending> {
    const target = path.join(this.deps.context.dir, 'CLAUDE.md');
    const exists = await this.deps.fs.exists(target);
    return pending(target, exists ? 'unchanged' : 'created', CLAUDE_POINTER);
  }
}
