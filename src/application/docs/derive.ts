// Derive marked workspace guides while preserving foreign files.

import path from 'node:path';

import { derive, isDerived } from '../../domain/docs/derived.js';
import { completeRegions } from '../../domain/docs/regions.js';
import { agentsSkeleton, CLAUDE_POINTER } from '../../domain/docs/skeleton.js';
import { renderAll } from '../../domain/docs/templates.js';
import type { LoginDeps } from '../login/deps.js';
import { assertWritable } from '../safety/posture.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import {
  actionFor,
  documentPath,
  finish,
  pending,
  reportRegions,
  type Pending,
  type RenderInput,
  type RenderOutput,
} from './rendered.js';
import { templateInputOf } from './template.js';

export class DeriveDocs {
  constructor(
    private readonly deps: WorkspaceDeps,
    private readonly login: Pick<LoginDeps, 'describeProvider'>,
  ) {}

  async execute(input: RenderInput): Promise<RenderOutput> {
    const { ctx, fs, reporter } = this.deps;
    const origin = path.join(ctx.manifestDir, 'AGENTS.md');
    const source = (await fs.readText(origin)) ?? agentsSkeleton(ctx.name);
    const rendered = completeRegions(
      source,
      renderAll(await templateInputOf(ctx.context, this.login, fs)),
    );
    const agents = await this.file(
      input.out ?? path.join(ctx.root, 'AGENTS.md'),
      derive(await this.sourceLinks(rendered.text), origin),
      rendered,
    );
    reportRegions(reporter, origin, agents.file);
    const files = [agents];
    if (input.out === undefined)
      files.push(await this.file(path.join(ctx.root, 'CLAUDE.md'), derive(CLAUDE_POINTER, origin)));
    const conflicts = files.filter((f) => f.file.action === 'foreign');
    if (!input.dryRun && !input.check && input.replace !== undefined && conflicts.length > 0) {
      assertWritable(input.posture, 'replace workspace documents');
      if (await input.replace(conflicts.map((f) => f.file.path))) {
        for (const conflict of conflicts) {
          const index = files.indexOf(conflict);
          files[index] = {
            ...conflict,
            before: { kind: 'absent', text: null },
            file: { ...conflict.file, action: 'updated', result: 'planned' },
          };
        }
      }
    }
    const foreign = files.filter((f) => f.file.action === 'foreign');
    if (foreign.length > 0)
      reporter.notice({
        code: 'DOCS_FOREIGN',
        message: `${foreign.map((f) => f.file.path).join(', ')} ${foreign.length === 1 ? 'was' : 'were'} not written by fx and left alone`,
        nextSteps: ['Move the file aside if fx should own it, then `fx sync --only docs`.'],
      });
    return finish(this.deps.projections, input, files);
  }

  private async sourceLinks(text: string): Promise<string> {
    const links = [
      ...text.matchAll(/\]\((<?)((?:\.\/)?(?:README\.md|(?:docs|skills)\/[^)#>]+))([^)]*)\)/g),
    ];
    for (const match of links) {
      const target = path.resolve(this.deps.ctx.manifestDir, decodeLink(match[2]!));
      if (!(await this.deps.fs.exists(target))) continue;
      const suffix = match[3]!.replace(/>$/, '');
      text = text.replace(match[0], `](<${target}${suffix}>)`);
    }
    return text;
  }

  private async file(
    target: string,
    text: string,
    regions?: Parameters<typeof pending>[4],
  ): Promise<Pending> {
    const before = await this.deps.projections.read(documentPath(target));
    const current = before.text ?? undefined;
    const foreign = before.kind === 'foreign' || (current !== undefined && !isDerived(current));
    return pending(target, foreign ? 'foreign' : actionFor(current, text), text, before, regions);
  }
}

function decodeLink(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
