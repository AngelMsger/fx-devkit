// Runs the three Skill product lines as one stage: plan them all, then write
// links and copies before any external tool process, and summarize the outcome.

import { withPartialResult } from '../../domain/errors.js';
import { assertWritable } from '../safety/posture.js';
import type { StageSummary } from '../sync/types.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import { applyCopies, planCopies } from './fx-copies.js';
import { observeCopy, observeLink } from './observe.js';
import type { SkillDeps } from './targets.js';
import { applyLinks, planLinks, replaceConflicts, reportForeign } from './team-links.js';
import { planTools, runTools, trustAll, trustedTools } from './tool-skills.js';
import type {
  FxSkillItem,
  SkillLinkItem,
  SkillStageInput,
  SkillStageOutput,
  ToolSkillItem,
} from './types.js';

export class SkillStage {
  constructor(
    private readonly deps: WorkspaceDeps,
    private readonly skills: SkillDeps,
  ) {}

  async execute(input: SkillStageInput): Promise<SkillStageOutput> {
    const status = input.dryRun ? 'planned' : 'not_started';
    const links: SkillLinkItem[] = (await planLinks(this.deps, this.skills, input.agents)).map(
      (item) => ({ ...item, status }),
    );
    const fx: FxSkillItem[] = (await planCopies(this.deps, this.skills, input.agents)).map(
      (item) => ({ ...item, status }),
    );
    const plannedTools: ToolSkillItem[] = (await planTools(this.deps, this.skills, input)).map(
      (item) => ({ ...item, status }),
    );
    let tools = input.background ? await trustedTools(plannedTools, input.trust) : plannedTools;
    try {
      const writes =
        links.some((i) => i.action === 'create' || i.action === 'prune') ||
        fx.some((i) => i.action === 'install' || i.action === 'upgrade') ||
        tools.some((t) => t.vector !== null);
      if (!input.dryRun && writes) assertWritable(input.posture, 'sync');
      if (!input.dryRun) {
        if (!input.background) tools = await trustAll(tools, input.trust);
        await replaceConflicts(this.deps, input, links);
        await applyLinks(this.deps, links);
        await applyCopies(this.deps, this.skills, fx, input);
      }
      // External tools last: their approval and exit codes must not decide whether
      // fx's own links and copies were written.
      if (!input.dryRun) await runTools(this.deps, tools);
      reportForeign(this.deps, links);
      return { links, fx, tools, summary: summarize(links, fx, tools) };
    } catch (error) {
      throw withPartialResult(error, {
        ...(await this.observed(links, fx)),
        tools,
        summary: summarize(links, fx, tools),
      });
    }
  }

  // An IO failure can occur after a write; report disk observations separately from completion.
  private async observed(
    links: readonly SkillLinkItem[],
    fx: readonly FxSkillItem[],
  ): Promise<object> {
    const read = async <T>(observe: () => Promise<T>): Promise<T | { kind: 'unknown' }> => {
      try {
        return await observe();
      } catch {
        return { kind: 'unknown' };
      }
    };
    return {
      links: await Promise.all(
        links.map(async (item) => ({
          ...item,
          observed: await read(() => observeLink(this.deps.fs, item.path)),
        })),
      ),
      fx: await Promise.all(
        fx.map(async (item) => ({
          ...item,
          observed: await read(() => observeCopy(this.deps.fs, item.path)),
        })),
      ),
    };
  }
}

const COPY_KEY: Record<FxSkillItem['action'], string> = {
  install: 'install',
  upgrade: 'upgrade',
  unchanged: 'current',
  foreign: 'foreign',
};

function summarize(
  links: readonly SkillLinkItem[],
  fx: readonly FxSkillItem[],
  tools: readonly ToolSkillItem[],
): StageSummary {
  const summary: Record<string, number> = {
    create: 0,
    unchanged: 0,
    prune: 0,
    foreign: 0,
    skip: 0,
    install: 0,
    upgrade: 0,
    current: 0,
    tools_run: 0,
    tools_failed: 0,
    tools_skipped: 0,
    tools_blocked: 0,
  };
  const bump = (key: string): void => {
    summary[key] = (summary[key] ?? 0) + 1;
  };
  for (const item of links)
    if (item.status !== 'not_started' && item.status !== 'failed') bump(item.action);
  for (const item of fx)
    if (item.status !== 'not_started' && item.status !== 'failed') bump(COPY_KEY[item.action]);
  for (const item of tools) {
    if (item.status === 'failed') bump('tools_failed');
    else if (item.status === 'not_started') bump('tools_not_started');
    else if (item.note === 'approval required') bump('tools_blocked');
    else if (item.vector === null) bump('tools_skipped');
    else bump(item.code === null || item.code === 0 ? 'tools_run' : 'tools_failed');
  }
  return summary;
}
