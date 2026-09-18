// External tools install their own Skills through their own executable. The
// vector is assembled from tool data, approved before it runs, and a refused
// approval is a blocked row rather than a failed stage.

import { asDevkitError, DevkitError, exitCodeFor, toEnvelope } from '../../domain/errors.js';
import { shellLine } from '../../domain/shell.js';
import { commandOrigin, type ResolvedTool } from '../../domain/toolchain/resolve.js';
import { errorEnvelope, stderrReason } from '../../domain/toolchain/stderr.js';
import type { ProcessResult } from '../../ports/process.js';
import { isTrustRequired, type TrustContext } from '../safety/trust.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import { applyItem } from './outcome.js';
import { skillTargets, type SkillDeps } from './targets.js';
import type { SkillStageInput, ToolSkillItem } from './types.js';

export async function planTools(
  deps: WorkspaceDeps,
  skills: SkillDeps,
  input: SkillStageInput,
): Promise<ToolSkillItem[]> {
  const targets = await skillTargets(skills, input.agents);
  const agents = targets.map((t) => t.agent);
  if (agents.length === 0) return [];
  const items: ToolSkillItem[] = [];
  for (const tool of input.toolchain ?? []) {
    if (!tool.enabled || tool.skill === undefined) {
      items.push(noVector(tool, 'ships no Skill'));
      continue;
    }
    if (
      (await deps.processWhich(tool.binary)) === undefined &&
      !(input.dryRun && tool.installOnInit)
    ) {
      items.push(missingToolSkill(tool));
      continue;
    }
    const flag = tool.skill.agentFlag;
    if (tool.skill.dirFlag !== undefined && flag === undefined) {
      const dirs = [...new Set(targets.map((target) => target.dir))];
      if (dirs.length === 0) items.push(noVector(tool, 'no selected agents'));
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

// Background runs never ask: an unapproved vector is dropped silently, because
// nobody is there to answer the prompt an approval would raise.
export async function trustedTools(
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

// Approve executable vectors before running them. A missing approval is a
// blocked tool row; independent owned local projections can still proceed.
export async function trustAll(
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

export async function runTools(deps: WorkspaceDeps, items: ToolSkillItem[]): Promise<void> {
  for (const [index, item] of items.entries()) {
    if (item.vector === null) {
      items[index] = { ...item, status: 'skipped' };
      continue;
    }
    await applyItem(items, index, async () => {
      deps.reporter.progress({ id: item.tool, state: 'start', detail: 'Skill installation' });
      const result = await deps.processRun(item.vector!, {
        diagnostic: { phase: `${item.tool} skill install` },
      });
      items[index] = { ...item, code: result.code };
      deps.reporter.progress({
        id: item.tool,
        state: result.code === 0 ? 'done' : 'fail',
        detail: 'Skill installation finished',
      });
      if (result.code !== 0)
        items[index] = { ...items[index]!, ...installFailure(deps, item.tool, result) };
    });
    if (items[index]!.code !== 0) items[index] = { ...items[index]!, status: 'failed' };
  }
}

function installFailure(
  deps: WorkspaceDeps,
  tool: string,
  result: ProcessResult,
): Pick<ToolSkillItem, 'note' | 'failure'> {
  const diagnostic = result.stderr.trim() || result.stdout.trim();
  const note = stderrReason(diagnostic, result.code);
  const failure = errorEnvelope(diagnostic);
  deps.reporter.notice({
    code: 'SKILL_INSTALL_FAILED',
    message: `${tool}: ${note}`,
    nextSteps: [shellLine(['fx', 'tool', 'show', tool], deps.commandShell)],
    data: { tool, exit: result.code, ...(failure === undefined ? {} : { failure }) },
  });
  return { note, ...(failure === undefined ? {} : { failure }) };
}

function noVector(tool: ResolvedTool, note: string): ToolSkillItem {
  return {
    tool: tool.name,
    vector: null,
    code: null,
    note,
    origin: commandOrigin(tool, 'skill'),
  };
}

function missingToolSkill(tool: ResolvedTool): ToolSkillItem {
  return {
    ...noVector(tool, 'not installed'),
    failure: toEnvelope(
      new DevkitError(
        'not_found',
        'TOOL_MISSING',
        `${tool.name} is required to prepare its Skill`,
        {
          nextSteps: [`fx tool show ${tool.name}`, `fx tool install ${tool.name} --dry-run`],
        },
      ),
    ).error,
  };
}
