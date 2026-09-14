// Derive marked workspace guides while preserving foreign files.

import path from 'node:path';

import { derive, isDerived } from '../../domain/docs/derived.js';
import { renderRegions } from '../../domain/docs/regions.js';
import { agentsSkeleton, CLAUDE_POINTER } from '../../domain/docs/skeleton.js';
import { renderAll } from '../../domain/docs/templates.js';
import type { LoginDeps } from '../login/deps.js';
import { assertWritable } from '../safety/posture.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

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

export class DeriveDocs {
  constructor(
    private readonly deps: WorkspaceDeps,
    private readonly login: Pick<LoginDeps, 'describeProvider'>,
  ) {}

  async execute(input: RenderInput): Promise<RenderOutput> {
    const { ctx, fs, reporter } = this.deps;
    const origin = path.join(ctx.manifestDir, 'AGENTS.md');
    const source = (await fs.readText(origin)) ?? agentsSkeleton(ctx.name);
    const rendered = renderRegions(source, renderAll(templateInputOf(ctx.context, this.login)));
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
          files[index] = { ...conflict, file: { ...conflict.file, action: 'updated' } };
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
    return finish(fs, input, files);
  }

  private async sourceLinks(text: string): Promise<string> {
    const links = [...text.matchAll(/\]\((<?)((?:\.\/)?(?:README\.md|docs\/[^)#>]+))([^)]*)\)/g)];
    for (const match of links) {
      const target = path.resolve(this.deps.ctx.manifestDir, match[2]!);
      if (!(await this.deps.fs.exists(target))) continue;
      const suffix = match[3]!.replace(/>$/, '');
      text = text.replace(match[0], `](<${target}${suffix}>)`);
    }
    return text;
  }

  private async file(
    target: string,
    text: string,
    regions?: Parameters<typeof pending>[3],
  ): Promise<Pending> {
    const occupied =
      (await this.deps.fs.isDirectory(target)) ||
      (await this.deps.fs.readLink(target)) !== undefined;
    const current = occupied ? undefined : await this.deps.fs.readText(target);
    const foreign = occupied || (current !== undefined && !isDerived(current));
    return pending(target, foreign ? 'foreign' : actionFor(current, text), text, regions);
  }
}
