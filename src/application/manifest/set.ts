// `manifest repo-set`: one scalar or alias array of one repository. The edited text is validated
// before anything is written, and an edit that introduces a problem the
// file did not already have is refused — the manifest never gets worse by
// going through fx.

import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';
import { setRepoField } from '../../domain/manifest/editor.js';
import { loadWorkspace } from '../../domain/manifest/loader.js';
import type { Problem } from '../../domain/manifest/types.js';
import type { FileSystem } from '../../ports/fs.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';

import { MANIFEST_FILES } from './locate.js';

export interface SetRepoFieldInput {
  readonly dir: string;
  readonly cliVersion: string;
  readonly repo: string;
  readonly field: string;
  readonly value: string;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}

export interface SetRepoFieldOutput {
  readonly path: string;
  readonly repo: string;
  readonly field: string;
  readonly before: string | null;
  readonly after: string;
  readonly written: boolean;
  readonly preview: readonly string[];
}

export class SetRepoField {
  constructor(
    private readonly fs: FileSystem,
    // Kept for symmetry with the other manifest use cases; the edit itself
    // only needs workspace.yaml.
    private readonly _bundledTools: () => string,
  ) {}

  async execute(input: SetRepoFieldInput): Promise<SetRepoFieldOutput> {
    const file = path.join(input.dir, MANIFEST_FILES.workspace);
    const original = (await this.fs.readText(file)) ?? '';
    const edit = setRepoField(original, input.repo, input.field, input.value);

    const opts = { cliVersion: input.cliVersion, allowInvalid: true as const };
    const before = new Set(loadWorkspace(original, opts).problems.map(key));
    const introduced = loadWorkspace(edit.text, opts).problems.filter((p) => !before.has(key(p)));
    if (introduced.length > 0) {
      throw new DevkitError(
        'config',
        'MANIFEST_INVALID',
        `the change would make the manifest invalid: ${introduced.map((p) => `${p.path}: ${p.message}`).join('; ')}`,
        { hint: 'Nothing was written.', nextSteps: [`fx manifest explain repos[].${input.field}`] },
      );
    }

    const plan: SetRepoFieldOutput = {
      path: file,
      repo: input.repo,
      field: input.field,
      before: edit.before,
      after: edit.after,
      written: false,
      preview: previewOf(original, edit.text),
    };
    if (input.dryRun) return plan;
    assertWritable(input.posture, `manifest repo-set ${input.repo} ${input.field}`);
    await this.fs.writeText(file, edit.text);
    return { ...plan, written: true };
  }
}

function key(problem: Problem): string {
  return `${problem.path}: ${problem.message}`;
}

// The changed lines only, in the two-line form readers know from diffs.
function previewOf(original: string, edited: string): string[] {
  const a = original.split('\n');
  const b = edited.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  return [...a.slice(start, endA).map((l) => `-${l}`), ...b.slice(start, endB).map((l) => `+${l}`)];
}
