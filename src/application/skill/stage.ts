// Plan and execute Skill projections, retaining per-item outcomes for recovery.

import path from 'node:path';

import { asDevkitError, exitCodeFor, toEnvelope, withPartialResult } from '../../domain/errors.js';
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

import { SkillCopies } from './copies.js';
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

interface ItemOutcome {
  readonly status?: 'planned' | 'not_started' | 'done' | 'failed' | 'skipped';
  readonly failure?: Readonly<Record<string, unknown>>;
}

export interface SkillLinkItem extends ItemOutcome {
  readonly agent: string;
  readonly path: string;
  readonly target: string;
  readonly action: LinkAction;
  readonly reason?: string;
}

export interface FxSkillItem extends ItemOutcome {
  readonly agent: string;
  readonly path: string;
  readonly action: CopyAction;
  readonly version: string;
}

export interface ToolSkillItem extends ItemOutcome {
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
    const status = input.dryRun ? 'planned' : 'not_started';
    const links: SkillLinkItem[] = (await this.planLinks(input.agents)).map((item) => ({
      ...item,
      status,
    }));
    const fx: FxSkillItem[] = (await this.planCopies(input.agents)).map((item) => ({
      ...item,
      status,
    }));
    const plannedTools: ToolSkillItem[] = (await this.planTools(input)).map((item) => ({
      ...item,
      status,
    }));
    let tools = input.background
      ? await this.trustedTools(plannedTools, input.trust)
      : plannedTools;
    try {
      const writes =
        links.some((i) => i.action === 'create' || i.action === 'prune') ||
        fx.some((i) => i.action === 'install' || i.action === 'upgrade') ||
        tools.some((t) => t.vector !== null);
      if (!input.dryRun && writes) assertWritable(input.posture, 'sync');
      if (!input.dryRun) {
        if (!input.background) tools = await this.trustAll(tools, input.trust);
        await this.replaceConflicts(input, links);
        await this.applyLinks(links);
        await this.applyCopies(fx, input);
      }
      if (!input.dryRun) await this.runTools(tools);
      this.reportForeign(links);
      return { links, fx, tools, summary: summarize(links, fx, tools) };
    } catch (error) {
      // An IO failure can occur after a write; report disk observations separately from completion.
      const observedLinks = await Promise.all(
        links.map(async (item) => ({
          ...item,
          observed: await this.observe(() => observeLink(this.deps.fs, item.path)),
        })),
      );
      const observedCopies = await Promise.all(
        fx.map(async (item) => ({
          ...item,
          observed: await this.observe(() => observeCopy(this.deps.fs, item.path)),
        })),
      );
      throw withPartialResult(error, {
        links: observedLinks,
        fx: observedCopies,
        tools,
        summary: summarize(links, fx, tools),
      });
    }
  }

  private async replaceConflicts(input: SkillStageInput, links: SkillLinkItem[]): Promise<void> {
    const conflicts: SkillLinkItem[] = [];
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
      }
    }
  }

  private async observe<T>(read: () => Promise<T>): Promise<T | { kind: 'unknown' }> {
    try {
      return await read();
    } catch {
      return { kind: 'unknown' };
    }
  }

  private async applyItem<T extends ItemOutcome>(
    items: T[],
    index: number,
    apply: () => Promise<void>,
  ): Promise<void> {
    try {
      await apply();
      items[index] = {
        ...items[index]!,
        status: items[index]!.status === 'skipped' ? 'skipped' : 'done',
      };
    } catch (error) {
      items[index] = {
        ...items[index]!,
        status: 'failed',
        failure: toEnvelope(asDevkitError(error)).error,
      };
      throw error;
    }
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

  private async applyLinks(items: SkillLinkItem[]): Promise<void> {
    for (const [index, item] of items.entries()) {
      await this.applyItem(items, index, async () => {
        if (item.action === 'create') await this.deps.fs.link(item.target, item.path);
        else if (item.action === 'prune') await this.deps.fs.remove(item.path);
        else items[index] = { ...item, status: 'skipped' };
      });
    }
  }

  private async applyCopies(items: FxSkillItem[], input: SkillStageInput): Promise<void> {
    const copies = new SkillCopies(this.deps.fs, this.deps.cliVersion, this.skills);
    for (const [index, item] of items.entries()) {
      await this.applyItem(items, index, async () => {
        const action = await copies.install(item.path, {
          posture: input.posture,
          ...(input.background || input.replace === undefined ? {} : { replace: input.replace }),
        });
        items[index] = {
          ...item,
          action,
          ...(action === 'install' || action === 'upgrade' ? {} : { status: 'skipped' as const }),
        };
      });
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

  private async runTools(items: ToolSkillItem[]): Promise<void> {
    for (const [index, item] of items.entries()) {
      if (item.vector === null) {
        items[index] = { ...item, status: 'skipped' };
        continue;
      }
      await this.applyItem(items, index, async () => {
        this.deps.reporter.progress({
          id: item.tool,
          state: 'start',
          detail: 'Skill installation',
        });
        const result = await this.deps.processRun(item.vector!, {
          diagnostic: { phase: `${item.tool} skill install` },
        });
        items[index] = { ...item, code: result.code };
        this.deps.reporter.progress({
          id: item.tool,
          state: result.code === 0 ? 'done' : 'fail',
          detail: 'Skill installation finished',
        });
        if (result.code !== 0)
          items[index] = { ...items[index]!, ...this.installFailure(item.tool, result) };
      });
      if (items[index]!.code !== 0) items[index] = { ...items[index]!, status: 'failed' };
    }
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
