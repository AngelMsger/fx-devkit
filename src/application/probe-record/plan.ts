// The plan binds a shared coordinate to unchanged source documents. It writes
// per-repository evidence whenever an environment-level edit could overstate it.

import path from 'node:path';

import { scanBoundary } from '../../domain/boundary/scan.js';
import { DevkitError } from '../../domain/errors.js';
import { MANIFEST_FILES } from '../../domain/manifest/files.js';
import { loadEnvironments, loadWorkspace } from '../../domain/manifest/loader.js';
import { setYamlStrings } from '../../domain/manifest/path-editor.js';
import type { Environments } from '../../domain/manifest/types.js';
import { coordinateFingerprint, probeScope } from '../../domain/obs/observation.js';
import { shellLine } from '../../domain/shell.js';
import { Where } from '../where.js';
import { findKnownRepo } from '../workspace/inspect.js';

import type {
  ProbeRecordPlan,
  RecordProbeDeps,
  RecordProbeInput,
  RecordProbeOutput,
} from './types.js';

export async function planProbeRecord(
  deps: RecordProbeDeps,
  input: RecordProbeInput,
): Promise<ProbeRecordPlan> {
  if (!input.probe || !input.env || !input.platform) throw inputRequired(input.repo);
  const documents = await readDocuments(deps);
  const [row] = await new Where(deps.workspace, deps.login).execute({
    ...input,
    probe: true,
    previewProbe: true,
    check: false,
  });
  if (!row) throw changed();
  const repo = findKnownRepo(deps.workspace, row.repo);
  assertShared(repo.origin);
  const template = row.probe_template ?? null;
  const entry = documents.environments.envs[row.env]?.platforms?.[row.platform];
  const scope =
    template && entry
      ? probeScope({
          template,
          vars: {
            ...documents.environments.platforms[row.platform]?.vars,
            ...entry.vars,
            ...repo.obs?.overrides?.[row.platform]?.[row.env]?.vars,
          },
          hasRepoOverride:
            documents.workspace.repos.some(
              (item) => item.obs?.overrides?.[row.platform]?.[row.env] !== undefined,
            ) || Object.keys(entry.observations ?? {}).length > 0,
        })
      : null;
  const base = ['envs', row.env, 'platforms', row.platform];
  const target = scope === 'repository' ? [...base, 'observations', row.repo] : base;
  const current = scope === 'repository' ? entry?.observations?.[row.repo] : entry;
  const output: RecordProbeOutput = {
    action: scope ? 'preview' : 'skipped',
    file: path.join(deps.workspace.ctx.manifestDir, MANIFEST_FILES.environments),
    scope,
    path: scope ? target : null,
    before: current?.confidence ?? null,
    after: null,
    note: null,
    row,
    written: false,
    handoff: null,
  };
  const plan = { ...documents, output, template, previousNote: current?.note ?? '' };
  if (scope) validatePreview(deps, plan);
  return plan;
}

function validatePreview(deps: RecordProbeDeps, plan: ProbeRecordPlan): void {
  assertSafeNote(JSON.stringify(plan.output.row.vars));
  assertSafeNote(plan.previousNote + '\n' + shellLine(plan.template!));
  const preview = setYamlStrings({
    text: plan.environmentSnapshot.text!,
    values: recordValues(plan, 'verified', plan.previousNote),
  });
  validateEdited(deps, plan, preview);
}

async function readDocuments(deps: RecordProbeDeps) {
  const root = deps.workspace.ctx.manifestDir;
  const workspaceSnapshot = await deps.files.read({ root, relative: MANIFEST_FILES.workspace });
  const environmentSnapshot = await deps.files.read({
    root,
    relative: MANIFEST_FILES.environments,
  });
  if (
    workspaceSnapshot.kind !== 'file' ||
    environmentSnapshot.kind !== 'file' ||
    workspaceSnapshot.text === null ||
    environmentSnapshot.text === null
  )
    throw new DevkitError(
      'config',
      'PROBE_RECORD_FILE_UNSAFE',
      'Recording requires regular source manifest files.',
      {
        nextSteps: [
          `Replace the symbolic links or missing files under ${root} with the regular manifest documents ${MANIFEST_FILES.workspace} and ${MANIFEST_FILES.environments}.`,
          'fx manifest validate',
        ],
      },
    );
  const opts = { cliVersion: deps.workspace.cliVersion, strict: true, allowInvalid: true as const };
  const workspace = loadWorkspace(workspaceSnapshot.text, opts);
  if (!workspace.valid || workspace.problems.length) throw invalid();
  const environments = loadEnvironments(environmentSnapshot.text, opts, {
    workspace: workspace.doc,
  });
  if (!environments.valid || environments.problems.length) throw invalid();
  if (
    JSON.stringify(workspace.doc) !==
      JSON.stringify(deps.workspace.ctx.manifest.workspace.result.doc) ||
    JSON.stringify(environments.doc) !==
      JSON.stringify(deps.workspace.ctx.manifest.environments?.result.doc)
  )
    throw changed();
  return {
    workspaceSnapshot,
    environmentSnapshot,
    workspace: workspace.doc,
    environments: environments.doc,
  };
}

export async function assertProbeSources(
  deps: RecordProbeDeps,
  plan: ProbeRecordPlan,
): Promise<void> {
  const root = deps.workspace.ctx.manifestDir;
  for (const [relative, before] of [
    [MANIFEST_FILES.workspace, plan.workspaceSnapshot],
    [MANIFEST_FILES.environments, plan.environmentSnapshot],
  ] as const) {
    const current = await deps.files.read({ root, relative });
    if (current.kind !== before.kind || current.text !== before.text) throw changed();
  }
}

export function recordValues(
  plan: ProbeRecordPlan,
  confidence: string,
  note: string,
): readonly { readonly path: readonly string[]; readonly value: string }[] {
  const target = plan.output.path!;
  const values = [
    { path: [...target, 'confidence'], value: confidence },
    { path: [...target, 'note'], value: note },
  ];
  if (plan.output.scope === 'repository')
    values.push({
      path: [...target, 'fingerprint'],
      value: coordinateFingerprint(plan.output.row),
    });
  return values;
}

export function validateEdited(
  deps: RecordProbeDeps,
  plan: ProbeRecordPlan,
  text: string,
): Environments {
  const result = loadEnvironments(
    text,
    { cliVersion: deps.workspace.cliVersion, strict: true, allowInvalid: true },
    { workspace: plan.workspace },
  );
  if (!result.valid || result.problems.length) throw invalid();
  return result.doc;
}

export function assertSafeNote(text: string): void {
  if (scanBoundary({ text, policy: 'manifest' }).length)
    throw new DevkitError(
      'config',
      'PROBE_RECORD_SENSITIVE',
      'The probe note contains protected content and cannot be recorded.',
      {
        nextSteps: [
          'Remove credentials, personal names and email addresses from the probe note, then run the probe again.',
        ],
      },
    );
}

function inputRequired(repo: string): DevkitError {
  return new DevkitError(
    'usage',
    'PROBE_RECORD_INPUT_REQUIRED',
    'Recording requires --probe, --env and --platform.',
    {
      nextSteps: [`fx where ${repo} --env <env> --platform <platform> --probe --record --dry-run`],
    },
  );
}

export function changed(): DevkitError {
  return new DevkitError(
    'conflict',
    'PROBE_RECORD_CHANGED',
    'Source documents or probe inputs changed; the result was not recorded.',
    { nextSteps: ['Review the current source and run the probe again.'] },
  );
}

function invalid(): DevkitError {
  return new DevkitError(
    'config',
    'PROBE_RECORD_MANIFEST_INVALID',
    'The source manifest must pass schema validation before recording.',
    { nextSteps: ['fx manifest validate', 'Fix the reported problems in the source, then retry.'] },
  );
}

function assertShared(origin: string): void {
  if (origin !== 'shared')
    throw new DevkitError(
      'usage',
      'PROBE_RECORD_SCOPE_INVALID',
      'Only shared repository coordinates can be recorded in the manifest.',
      {
        nextSteps: [
          'fx repo list',
          'Record a repository the shared manifest owns; locally added repositories keep their coordinates in personal configuration.',
        ],
      },
    );
}
