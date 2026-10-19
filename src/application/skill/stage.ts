// Runs the three Skill product lines as one stage: plan them all, then write
// links and copies before any external tool process, and summarize the outcome.

import { withPartialResult } from '../../domain/errors.js';
import { isUnfinished } from '../../domain/outcome.js';
import { countBy } from '../../domain/values.js';
import { assertWritable } from '../safety/posture.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import { applyCopies, planCopies } from './fx-copies.js';
import { observeCopy, observeLink } from './observe.js';
import type { SkillDeps } from './targets.js';
import { applyLinks, planLinks, replaceConflicts, reportForeign } from './team-links.js';
import { awaitsApproval, planTools, runTools, trustAll, trustedTools } from './tool-skills.js';
import type {
  FxSkillItem,
  ItemOutcome,
  ObservedSkills,
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
    let tools = input.background
      ? await trustedTools(plannedTools, input.toolchain, this.deps.trust)
      : plannedTools;
    try {
      const writes =
        links.some((i) => i.action === 'create' || i.action === 'prune') ||
        fx.some((i) => i.action === 'install' || i.action === 'upgrade') ||
        tools.some((t) => t.vector !== null);
      if (!input.dryRun && writes) assertWritable(input.posture, 'sync');
      if (!input.dryRun) {
        if (!input.background) tools = await trustAll(tools, input.toolchain, this.deps.trust);
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
  ): Promise<ObservedSkills> {
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
): SkillStageOutput['summary'] {
  const finished = (item: ItemOutcome): boolean => !isUnfinished(item.status);
  const keys = [
    ...links.filter(finished).map((item) => item.action),
    ...fx.filter(finished).map((item) => COPY_KEY[item.action]),
    ...tools.map(toolSummaryKey),
  ];
  return {
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
    ...countBy(keys, (key) => key),
  };
}

function toolSummaryKey(item: ToolSkillItem): string {
  if (item.status === 'failed') return 'tools_failed';
  if (item.status === 'not_started') return 'tools_not_started';
  if (awaitsApproval(item)) return 'tools_blocked';
  if (item.vector === null) return 'tools_skipped';
  return item.code === null || item.code === 0 ? 'tools_run' : 'tools_failed';
}
