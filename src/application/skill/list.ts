// Every team Skill and fx's own, with the state each enabled agent has them in.
// A listing only reads; what to do about a state is the skills stage's business.

import path from 'node:path';

import {
  decideCopy,
  decideLink,
  type CopyAction,
  type LinkAction,
} from '../../domain/skills/projection.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import { FX_SKILL, observeCopy, observeLink, teamSkills, teamSkillsRoot } from './observe.js';
import { projectSkillTargets, skillTargets, type SkillDeps } from './targets.js';

export type SkillState = 'installed' | 'missing' | 'outdated' | 'foreign';

// A listing reports state, not intent: the projection decisions fold onto it.
const LINK_STATE: Record<LinkAction, SkillState> = {
  unchanged: 'installed',
  foreign: 'foreign',
  create: 'missing',
  prune: 'missing',
  skip: 'missing',
};
const COPY_STATE: Record<CopyAction, SkillState> = {
  unchanged: 'installed',
  upgrade: 'outdated',
  foreign: 'foreign',
  install: 'missing',
};

export interface SkillListInput {
  readonly agents?: readonly string[] | undefined;
}

export interface SkillRow {
  readonly name: string;
  readonly kind: 'team' | 'fx';
  readonly source: string;
  readonly states: Readonly<Record<string, SkillState>>;
}

export class SkillList {
  constructor(
    private readonly deps: WorkspaceDeps,
    private readonly skills: SkillDeps,
  ) {}

  async execute(input: SkillListInput): Promise<SkillRow[]> {
    const { fs, ctx } = this.deps;
    const targets = await skillTargets(this.skills, input.agents);
    const target = teamSkillsRoot(ctx.manifestDir);
    const hasSource = await fs.isDirectory(target);
    // The team Skills share one link per agent, so every team row reads the same states.
    const linked: Record<string, SkillState> = {};
    for (const at of await projectSkillTargets(this.skills, ctx.root, input.agents)) {
      const decision = decideLink(await observeLink(fs, at.dir), target, hasSource);
      linked[at.agent] = LINK_STATE[decision.action];
    }
    const rows: SkillRow[] = [];
    for (const source of await teamSkills(fs, ctx.manifestDir))
      rows.push({ name: source.name, kind: 'team', source: source.dir, states: linked });
    const fxStates: Record<string, SkillState> = {};
    for (const target of targets) {
      const action = decideCopy(
        await observeCopy(this.deps.fs, path.join(target.dir, FX_SKILL)),
        this.deps.cliVersion,
      );
      fxStates[target.agent] = COPY_STATE[action];
    }
    rows.push({
      name: FX_SKILL,
      kind: 'fx',
      source: this.skills.bundledSkillDir,
      states: fxStates,
    });
    return rows;
  }
}
