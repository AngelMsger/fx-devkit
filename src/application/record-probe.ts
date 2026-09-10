// Records only this invocation's definite probe evidence. Readiness prompts
// stay outside the workspace lease; source snapshots are rechecked before writing.

import { handoffEnvelope, DevkitError, type HandoffEnvelope } from '../domain/errors.js';
import { MANIFEST_FILES } from '../domain/manifest/files.js';
import { setYamlStrings } from '../domain/manifest/path-editor.js';
import { coordinateFingerprint } from '../domain/obs/observation.js';
import { confidenceForProbe } from '../domain/obs/probe.js';
import { shellLine } from '../domain/shell.js';

import {
  assertProbeSources,
  assertSafeNote,
  changed,
  planProbeRecord,
  recordValues,
  validateEdited,
} from './probe-record/plan.js';
import type {
  ProbeRecordPlan,
  RecordProbeDeps,
  RecordProbeInput,
  RecordProbeOutput,
} from './probe-record/types.js';
import { assertWritable } from './safety/posture.js';
import { Where, type WhereRow } from './where.js';

export class RecordProbe {
  constructor(private readonly deps: RecordProbeDeps) {}

  async execute(input: RecordProbeInput): Promise<RecordProbeOutput> {
    const plan = await planProbeRecord(this.deps, input);
    if (!plan.template || !plan.output.scope)
      return { ...plan.output, handoff: recovery(plan.output.row) };
    if (input.dryRun) return plan.output;
    assertWritable(input.posture, 'where --probe --record');
    const where = new Where(this.deps.workspace, this.deps.login);
    const [ready] = await where.execute({ ...input, probe: false, check: input.check });
    const lease = await this.deps.lock.acquire({
      key: `workspace:${this.deps.workspace.ctx.name}`,
      waitMs: 2000,
    });
    if (!lease)
      throw new DevkitError(
        'conflict',
        'PROBE_RECORD_BUSY',
        'Another operation holds this workspace.',
      );
    try {
      await assertProbeSources(this.deps, plan);
      const [probed] = await where.execute({
        ...input,
        check: false,
        probe: true,
        previewProbe: false,
      });
      if (
        !probed ||
        coordinateFingerprint(probed) !== coordinateFingerprint(plan.output.row) ||
        JSON.stringify(probed.probe_template) !== JSON.stringify(plan.template)
      )
        throw changed();
      const row = { ...probed, ready: ready?.ready ?? null, handoff: ready?.handoff ?? null };
      return await this.record(plan, row);
    } finally {
      await lease.release();
    }
  }

  private async record(plan: ProbeRecordPlan, row: WhereRow): Promise<RecordProbeOutput> {
    const after = confidenceForProbe(row.outcome ?? 'unknown');
    if (!after)
      return { ...plan.output, row, action: 'skipped', handoff: row.handoff ?? recovery(row) };
    await assertProbeSources(this.deps, plan);
    const note = appendNote(
      plan.previousNote,
      `${this.deps.clock.now().toISOString().slice(0, 10)} UTC: ${row.outcome}; ${shellLine(plan.template!)}`,
    );
    assertSafeNote(note);
    const text = setYamlStrings({
      text: plan.environmentSnapshot.text!,
      values: recordValues(plan, after, note),
    });
    validateEdited(this.deps, plan, text);
    const output = { ...plan.output, row, after, note, handoff: row.handoff };
    if (text === plan.environmentSnapshot.text) return { ...output, action: 'unchanged' };
    const result = await this.deps.files.write({
      root: this.deps.workspace.ctx.manifestDir,
      relative: MANIFEST_FILES.environments,
      before: plan.environmentSnapshot,
      text,
    });
    if (result === 'conflict' || result === 'busy') throw changed();
    return {
      ...output,
      action: result === 'written' ? 'recorded' : 'unchanged',
      written: result === 'written',
    };
  }
}

function appendNote(before: string, line: string): string {
  if (before.split('\n').includes(line)) return before;
  if (!before) return line;
  return before + (before.endsWith('\n') ? '' : '\n') + line;
}

function recovery(row: WhereRow): HandoffEnvelope {
  const command = shellLine(['fx', 'can', row.capability, '--env', row.env]);
  return handoffEnvelope({
    summary: 'No definite, recordable coordinate probe result is available.',
    command,
    userSteps: [
      {
        id: 'coordinate-probe',
        kind: 'manual',
        title: 'Check the platform capability and access, then retry a supported coordinate probe.',
      },
    ],
  });
}
