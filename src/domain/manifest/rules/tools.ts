// Cross-field rules of a tools document: names, executables and argument
// vectors are legible, every tool can be installed somehow, setup steps are
// well-formed. They run on the bundled defaults, on the team patch, and on
// the merged result, since a patch can break an entry that was fine alone.

import { isSemver } from '../../semver.js';
import type { Problem, Tool, Toolchain } from '../types.js';

import { argumentProblem, binaryProblem } from './vectors.js';

// A patch inherits the baseline's requirements, so only one thing is its own to get wrong.
export function toolsPatchRules(doc: Toolchain): Problem[] {
  return doc.tools.flatMap((tool, i) =>
    tool.opt_in === undefined
      ? []
      : [{ path: `tools[${i}].opt_in`, message: 'is decided by the bundled baseline; remove it' }],
  );
}

export function toolsRules(doc: Toolchain): Problem[] {
  const problems: Problem[] = [];
  if (doc.min_cli !== undefined && !isSemver(doc.min_cli)) {
    problems.push({ path: 'min_cli', message: 'must be a semantic version' });
  }
  const seen = new Map<string, number>();
  doc.tools.forEach((tool, i) => {
    const at = `tools[${i}]`;
    const first = seen.get(tool.name);
    if (first !== undefined)
      problems.push({ path: `${at}.name`, message: `duplicates tools[${first}]` });
    else seen.set(tool.name, i);
    problems.push(...toolRules(tool, at, doc));
  });
  return problems;
}

function toolRules(tool: Tool, at: string, doc: Toolchain): Problem[] {
  const problems: Problem[] = [];
  const push = (path: string, message: string | undefined): void => {
    if (message !== undefined) problems.push({ path, message });
  };
  push(`${at}.name`, binaryProblem(tool.name));
  if (tool.binary !== undefined) push(`${at}.binary`, binaryProblem(tool.binary));
  if (tool.min_version !== undefined && !isSemver(tool.min_version)) {
    push(`${at}.min_version`, 'must be a semantic version');
  }
  const installs = tool.install ?? doc.defaults?.install ?? [];
  if (installs.length === 0)
    push(`${at}.install`, 'no install method here or under defaults.install');

  const vectors: [string, readonly string[] | undefined][] = [
    [`${at}.version_args`, tool.version_args],
    [`${at}.skill.command`, tool.skill?.command],
    [`${at}.auth.command`, tool.auth?.command],
  ];
  const ids = new Map<string, number>();
  (tool.setup ?? []).forEach((step, k) => {
    const stepAt = `${at}.setup[${k}]`;
    const first = ids.get(step.id);
    if (first !== undefined) push(`${stepAt}.id`, `duplicates setup[${first}]`);
    else ids.set(step.id, k);
    if (step.kind === 'run' && step.run === undefined)
      push(`${stepAt}.run`, 'a run step needs a command');
    if (step.kind === 'file' && step.expects === undefined)
      push(`${stepAt}.expects`, 'a file step needs expects.path');
    vectors.push([`${stepAt}.run`, step.run]);
    if ('command' in step.verify) vectors.push([`${stepAt}.verify.command`, step.verify.command]);
  });
  for (const [path, vector] of vectors) {
    (vector ?? []).forEach((arg, j) => push(`${path}[${j}]`, argumentProblem(arg)));
  }
  return problems;
}
