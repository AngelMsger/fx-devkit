// The skills stage of `fx sync`: every Skill projection in one pass. The team
// Skills are linked, fx's own Skill is copied under its version, and each
// installed tool runs its own `skill install` — a manifest vector, so it
// passes the trust gate. Foreign paths need explicit replacement approval
// and a backup; otherwise they are reported and kept.

import path from 'node:path';

import { asDevkitError, DevkitError, exitCodeFor, toEnvelope } from '../../domain/errors.js';
import { shellLine } from '../../domain/shell.js';
import {
  decideCopy,
  decideLink,
  type CopyAction,
  type LinkAction,
} from '../../domain/skills/projection.js';
import { commandOrigin, type ResolvedTool } from '../../domain/toolchain/resolve.js';
import { errorEnvelope, stderrReason } from '../../domain/toolchain/stderr.js';
import type { ProcessResult } from '../../ports/process.js';
import type { ReplaceFiles } from '../../ports/replace-files.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';
import { isTrustRequired } from '../safety/trust.js';
import type { TrustContext } from '../safety/trust.js';
import type { StageSummary } from '../sync.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import { FX_SKILL, observeCopy, observeLink, teamSkillsRoot } from './observe.js';
import { projectSkillTargets, skillTargets, type SkillDeps } from './targets.js';

export interface SkillStageInput {
  readonly background?: boolean;
  readonly replace?: ReplaceFiles;
  readonly agents?: readonly string[] | undefined;
  readonly toolchain?: readonly ResolvedTool[] | undefined;
  readonly trust?: TrustContext | undefined;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}

export interface SkillLinkItem {
  readonly agent: string;
  readonly path: string;
  readonly target: string;
  readonly action: LinkAction;
  readonly reason?: string;
}

export interface FxSkillItem {
  readonly agent: string;
  readonly path: string;
  readonly action: CopyAction;
  readonly version: string;
}

export interface ToolSkillItem {
  readonly tool: string;
  readonly vector: readonly string[] | null;
  readonly code: number | null;
  readonly note?: string;
  readonly failure?: Readonly<Record<string, unknown>>;
  readonly origin: ResolvedTool['origins']['skill'];
}

export interface SkillStageOutput {
  readonly links: readonly SkillLinkItem[];
  readonly fx: readonly FxSkillItem[];
  readonly tools: readonly ToolSkillItem[];
  readonly summary: StageSummary;
}

export class SkillStage {
  constructor(
    private readonly deps: WorkspaceDeps,
    private readonly skills: SkillDeps,
  ) {}

  async execute(input: SkillStageInput): Promise<SkillStageOutput> {
    const links = await this.planLinks(input.agents);
    const fx = await this.planCopies(input.agents);
    const plannedTools = await this.planTools(input);
    let tools = input.background
      ? await this.trustedTools(plannedTools, input.trust)
      : plannedTools;
    const writes =
      links.some((i) => i.action === 'create' || i.action === 'prune') ||
      fx.some((i) => i.action === 'install' || i.action === 'upgrade') ||
      tools.some((t) => t.vector !== null);
    if (!input.dryRun && writes) assertWritable(input.posture, 'sync');
    if (!input.dryRun) {
      if (!input.background) tools = await this.trustAll(tools, input.trust);
      const conflicts: (SkillLinkItem | FxSkillItem)[] = fx.filter(
        (item) => item.action === 'foreign',
      );
      for (const item of links) {
        if (item.action === 'foreign' && (await this.deps.fs.isDirectory(item.target)))
          conflicts.push(item);
      }
      if (input.replace !== undefined && conflicts.length > 0) {
        assertWritable(input.posture, 'replace Skill paths');
        if (await input.replace(conflicts.map((item) => item.path))) {
          for (let index = 0; index < links.length; index++) {
            const item = links[index]!;
            if (conflicts.includes(item)) links[index] = { ...item, action: 'create' };
          }
          for (let index = 0; index < fx.length; index++) {
            const item = fx[index]!;
            if (conflicts.includes(item)) fx[index] = { ...item, action: 'install' };
          }
        }
      }
      await this.applyLinks(links);
      await this.applyCopies(fx);
    }
    const ran = input.dryRun ? tools : await this.runTools(tools);
    this.reportForeign(links);
    return { links, fx, tools: ran, summary: summarize(links, fx, ran) };
  }

  private async planLinks(agents: readonly string[] | undefined): Promise<SkillLinkItem[]> {
    const { fs, ctx } = this.deps;
    const target = teamSkillsRoot(ctx.manifestDir);
    const hasSource = await fs.isDirectory(target);
    const items: SkillLinkItem[] = [];
    for (const at of await projectSkillTargets(this.skills, ctx.root, agents)) {
      const decision = decideLink(await observeLink(fs, at.dir), target, hasSource);
      items.push({
        agent: at.agent,
        path: at.dir,
        target,
        action: decision.action,
        ...(decision.reason === undefined ? {} : { reason: decision.reason }),
      });
    }
    return items;
  }

  private async trustedTools(
    items: readonly ToolSkillItem[],
    trust?: TrustContext,
  ): Promise<ToolSkillItem[]> {
    const result: ToolSkillItem[] = [];
    for (const item of items) {
      if (
        item.vector === null ||
        item.origin === 'base' ||
        (trust &&
          (await trust.gate.isTrusted({
            workspace: trust.workspace,
            vector: item.vector,
            origin: item.origin,
          })))
      )
        result.push(item);
      else result.push({ ...item, vector: null, note: 'untrusted' });
    }
    return result;
  }

  private async planCopies(agents: readonly string[] | undefined): Promise<FxSkillItem[]> {
    const items: FxSkillItem[] = [];
    for (const target of await skillTargets(this.skills, agents)) {
      const at = path.join(target.dir, FX_SKILL);
      const action = decideCopy(await observeCopy(this.deps.fs, at), this.deps.cliVersion);
      items.push({ agent: target.agent, path: at, action, version: this.deps.cliVersion });
    }
    return items;
  }

  private async planTools(input: SkillStageInput): Promise<ToolSkillItem[]> {
    const targets = await skillTargets(this.skills, input.agents);
    const agents = targets.map((t) => t.agent);
    if (agents.length === 0) return [];
    const items: ToolSkillItem[] = [];
    for (const tool of input.toolchain ?? []) {
      if (!tool.enabled || tool.skill === undefined) {
        items.push({
          tool: tool.name,
          vector: null,
          code: null,
          note: 'ships no Skill',
          origin: commandOrigin(tool, 'skill'),
        });
        continue;
      }
      if (
        (await this.deps.processWhich(tool.binary)) === undefined &&
        !(input.dryRun && tool.installOnInit)
      ) {
        items.push({
          tool: tool.name,
          vector: null,
          code: null,
          note: 'not installed',
          origin: commandOrigin(tool, 'skill'),
        });
        continue;
      }
      const flag = tool.skill.agentFlag;
      if (tool.skill.dirFlag !== undefined && flag === undefined) {
        const dirs = [...new Set(targets.map((target) => target.dir))];
        if (dirs.length === 0) {
          items.push({
            tool: tool.name,
            vector: null,
            code: null,
            note: 'no selected agents',
            origin: commandOrigin(tool, 'skill'),
          });
        }
        for (const dir of dirs) {
          items.push({
            tool: tool.name,
            vector: [tool.binary, ...tool.skill.command, tool.skill.dirFlag, dir],
            code: null,
            origin: commandOrigin(tool, 'skill'),
          });
        }
        continue;
      }
      const vector = [
        tool.binary,
        ...tool.skill.command,
        ...(flag === undefined ? [] : agents.flatMap((a) => [flag, a])),
      ];
      items.push({ tool: tool.name, vector, code: null, origin: commandOrigin(tool, 'skill') });
    }
    return items;
  }

  private async applyLinks(items: readonly SkillLinkItem[]): Promise<void> {
    for (const item of items) {
      if (item.action === 'create') await this.deps.fs.link(item.target, item.path);
      if (item.action === 'prune') await this.deps.fs.remove(item.path);
    }
  }

  private async applyCopies(items: FxSkillItem[]): Promise<void> {
    for (let index = 0; index < items.length; index++) {
      const item = items[index]!;
      if (item.action !== 'install' && item.action !== 'upgrade') continue;
      const lease = await this.skills.globalLock?.acquire({
        key: `skill:${item.path}`,
        waitMs: 2000,
      });
      if (lease === null)
        throw new DevkitError('conflict', 'SKILL_BUSY', 'The user Skill is being updated', {
          nextSteps: ['Retry fx sync --only skills.'],
        });
      try {
        const action = decideCopy(await observeCopy(this.deps.fs, item.path), this.deps.cliVersion);
        items[index] = { ...item, action };
        if (action === 'install' || action === 'upgrade')
          await this.deps.fs.replaceDir(this.skills.bundledSkillDir, item.path);
      } finally {
        await lease?.release();
      }
    }
  }

  // Approve executable vectors before running them. A missing approval is a
  // blocked tool row; independent owned local projections can still proceed.
  private async trustAll(
    items: readonly ToolSkillItem[],
    trust?: TrustContext,
  ): Promise<ToolSkillItem[]> {
    if (trust === undefined) return [...items];
    const approved: ToolSkillItem[] = [];
    for (const item of items) {
      if (item.vector === null) {
        approved.push(item);
        continue;
      }
      try {
        await trust.gate.ensure({
          workspace: trust.workspace,
          vector: item.vector,
          label: `${item.tool} skill install`,
          origin: item.origin,
          yes: trust.yes,
          posture: trust.posture,
        });
        approved.push(item);
      } catch (error) {
        if (!isTrustRequired(error)) throw error;
        const failure = asDevkitError(error);
        approved.push({
          ...item,
          vector: null,
          code: exitCodeFor(failure.category),
          note: 'approval required',
          failure: toEnvelope(failure).error,
        });
      }
    }
    return approved;
  }

  private async runTools(items: readonly ToolSkillItem[]): Promise<ToolSkillItem[]> {
    const ran: ToolSkillItem[] = [];
    for (const item of items) {
      if (item.vector === null) {
        ran.push(item);
        continue;
      }
      this.deps.reporter.progress({
        id: item.tool,
        state: 'start',
        detail: 'local Skill installation; caller approval was checked before execution',
      });
      const result = await this.deps.processRun(item.vector, {
        diagnostic: { phase: `${item.tool} skill install` },
      });
      this.deps.reporter.progress({
        id: item.tool,
        state: result.code === 0 ? 'done' : 'fail',
        detail: 'Skill installation finished',
      });
      ran.push({
        ...item,
        code: result.code,
        ...(result.code === 0 ? {} : this.installFailure(item.tool, result)),
      });
    }
    return ran;
  }

  private installFailure(
    tool: string,
    result: ProcessResult,
  ): Pick<ToolSkillItem, 'note' | 'failure'> {
    const diagnostic = result.stderr.trim() || result.stdout.trim();
    const note = stderrReason(diagnostic, result.code);
    const failure = errorEnvelope(diagnostic);
    this.deps.reporter.notice({
      code: 'SKILL_INSTALL_FAILED',
      message: `${tool}: ${note}`,
      nextSteps: [shellLine(['fx', 'tool', 'show', tool], this.deps.commandShell)],
      data: { tool, exit: result.code, ...(failure === undefined ? {} : { failure }) },
    });
    return { note, ...(failure === undefined ? {} : { failure }) };
  }

  private reportForeign(links: readonly SkillLinkItem[]): void {
    const foreign = links.filter((i) => i.action === 'foreign');
    if (foreign.length === 0) return;
    this.deps.reporter.notice({
      code: 'SKILL_FOREIGN',
      message: `${foreign.length} Skill location(s) hold something fx did not create and were left alone: ${foreign.map((f) => f.path).join(', ')}`,
      nextSteps: ['Move or remove them by hand if the team Skills should be linked there.'],
    });
  }
}

// fx's copy counts under its own words; "foreign" is one word for both.
const COPY_KEY: Record<CopyAction, string> = {
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
  for (const item of links) bump(item.action);
  for (const item of fx) bump(COPY_KEY[item.action]);
  for (const item of tools) {
    if (item.note === 'approval required') bump('tools_blocked');
    else if (item.vector === null) bump('tools_skipped');
    else bump(item.code === null || item.code === 0 ? 'tools_run' : 'tools_failed');
  }
  return summary;
}
