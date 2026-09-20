// Rendering the generated regions of AGENTS.md (and the CLAUDE.md pointer) inside a
// checkout of the manifest repository, for its maintainers and its CI. Prose outside the
// regions is preserved using a captured snapshot; a draft may target another path.

import path from 'node:path';

import { renderRegions } from '../../domain/docs/regions.js';
import { agentsSkeleton, CLAUDE_POINTER } from '../../domain/docs/skeleton.js';
import { renderAll } from '../../domain/docs/templates.js';
import type { FileSystem } from '../../ports/fs.js';
import type { ProjectionStore } from '../../ports/projection.js';
import type { Reporter } from '../../ports/reporter.js';
import type { LoginDeps } from '../login/deps.js';
import type { ManifestContext } from '../manifest/context.js';

import {
  actionFor,
  documentPath,
  documentConflict,
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
  readonly projections: ProjectionStore;
  readonly reporter: Reporter;
  readonly context: ManifestContext;
}

export class RenderRegions {
  constructor(private readonly deps: RenderRegionsDeps) {}

  async execute(input: RenderInput): Promise<RenderOutput> {
    const agents = await this.agents(input.out);
    const files = [agents];
    if (input.out === undefined) files.push(await this.claude());
    reportRegions(this.deps.reporter, agents.file.path, agents.file);
    const result = await finish(this.deps.projections, input, files);
    if (result.files[0]?.action === 'created' && result.files[0].result === 'done')
      this.deps.reporter.notice({
        code: 'DOCS_CREATED',
        message: `${agents.file.path} did not exist; a skeleton with every region was written`,
      });
    return result;
  }

  private async agents(out: string | undefined): Promise<Pending> {
    const source = path.join(this.deps.context.dir, 'AGENTS.md');
    const target = out ?? source;
    // A draft written elsewhere is always fresh: the skeleton, fully rendered.
    const before = await this.deps.projections.read(documentPath(target));
    if (before.kind === 'foreign') throw documentConflict(target);
    const existing = out === undefined ? (before.text ?? undefined) : undefined;
    const base = existing ?? agentsSkeleton(path.basename(this.deps.context.dir));
    const rendered = renderRegions(
      base,
      renderAll(await templateInputOf(this.deps.context, this.deps, this.deps.fs)),
    );
    return pending(
      target,
      actionFor(before.text ?? undefined, rendered.text),
      rendered.text,
      before,
      rendered,
    );
  }

  private async claude(): Promise<Pending> {
    const target = path.join(this.deps.context.dir, 'CLAUDE.md');
    const before = await this.deps.projections.read(documentPath(target));
    return pending(
      target,
      before.kind === 'absent' ? 'created' : 'unchanged',
      CLAUDE_POINTER,
      before,
    );
  }
}
