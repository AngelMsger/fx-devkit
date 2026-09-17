import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createRenderer, type RenderOptions } from '../../../src/cli/render/index.js';
import { DevkitError, toEnvelope } from '../../../src/domain/errors.js';

function render(options: RenderOptions = {}, format: 'json' | 'ndjson' = 'json') {
  let stdout = '';
  let stderr = '';
  const io = {
    out: new Writable({
      write(chunk, _encoding, callback) {
        stdout += String(chunk);
        callback();
      },
    }),
    err: new Writable({
      write(chunk, _encoding, callback) {
        stderr += String(chunk);
        callback();
      },
    }),
  };
  return {
    renderer: createRenderer(format, io, { report: 'init', ...options }),
    out: () => stdout,
    err: () => stderr,
  };
}

const failure = toEnvelope(
  new DevkitError('config', 'VECTOR_UNTRUSTED', 'Review this exact command', {
    nextSteps: ['sample-cli skill install --dir /home/example/skills'],
  }),
).error;
const vector = ['sample-cli', 'skill', 'install', '--dir', '/home/example/skills'];
const report = {
  operation: 'apply',
  preparation_complete: false,
  registered: true,
  written: true,
  failed_phase: 'sync',
  next_steps: ['fx sync --only repos,docs --format json'],
  sync: {
    items: [
      ...Array.from({ length: 70 }, (_, i) => ({
        name: `sample-${i}`,
        path: `sample-${i}`,
        action: 'skip_unpicked',
        result: 'skipped',
        reason: 'not selected on this machine; select the repository before synchronizing it',
      })),
      { name: 'protected', action: 'skip_dirty', result: 'skipped', reason: 'keep local edits' },
    ],
    summary: { done: 0, failed: 0, skipped: 71 },
    stages: { skills: { status: 'failed' }, hooks: { status: 'not_started' } },
    stage_details: { skills: { tools: [{ tool: 'sample', vector, status: 'failed', failure }] } },
  },
};

describe('workflow JSON summaries', () => {
  it('cuts a 70-unpicked report by 70% without losing protected work, stages or exact recovery', () => {
    const summary = render();
    const details = render({ details: true });
    summary.renderer.record(report);
    details.renderer.record(report);
    const result = JSON.parse(summary.out());
    expect(result).toMatchObject({
      operation: 'apply',
      preparation_complete: false,
      failed_phase: 'sync',
      omitted: { 'sync.items': 70 },
      sync: {
        items: [report.sync.items[70]],
        stages: report.sync.stages,
        stage_details: report.sync.stage_details,
      },
      next_steps: report.next_steps,
    });
    expect(JSON.parse(details.out())).toEqual(report);
    expect(Buffer.byteLength(summary.out())).toBeLessThan(Buffer.byteLength(details.out()) * 0.3);
    expect(report.sync.items).toHaveLength(71);
  });

  it('keeps every warning and failure while omitting successful findings and large evidence', () => {
    const t = render({ report: 'doctor' });
    t.renderer.record({
      ok: false,
      complete: false,
      summary: { ok: 1, warn: 1, fail: 1 },
      findings: [
        { id: 'done', level: 'ok', coverage: 'checked' },
        {
          id: 'gap',
          level: 'warn',
          coverage: 'incomplete',
          handoff: { summary: 'need access', user_steps: [] },
          evidence: { payload: 'large' },
        },
        {
          id: 'broken',
          level: 'fail',
          coverage: 'checked',
          fix: 'inspect',
          evidence: { payload: 'large' },
        },
      ],
    });
    const out = JSON.parse(t.out());
    expect(out).toMatchObject({
      ok: false,
      complete: false,
      omitted: { findings: 1, 'findings.evidence': 2 },
    });
    expect(out.findings).toHaveLength(2);
    expect(out.findings[0].handoff.summary).toBe('need access');
    expect(out.findings[1].fix).toBe('inspect');
  });

  it('projects explicit fields from the full result and leaves NDJSON and fact queries full', () => {
    const projected = render({ fields: ['sync.items.name'] });
    projected.renderer.record(report);
    expect(JSON.parse(projected.out())['sync.items.name']).toHaveLength(71);
    const ndjson = render({}, 'ndjson');
    ndjson.renderer.record(report);
    expect(JSON.parse(ndjson.out())).toEqual(report);
    const facts = render({ report: undefined });
    facts.renderer.record(report);
    expect(JSON.parse(facts.out())).toEqual(report);
  });

  it('compacts initialization plans but retains pending vectors and untouched error envelopes', () => {
    const t = render();
    t.renderer.notice({
      code: 'INIT_PREPARED',
      message: 'planned',
      data: {
        plan: {
          skills: {
            tools: [
              { tool: 'none', vector: null, note: 'no selected agents' },
              { tool: 'sample', origin: 'patch', status: 'planned', vector },
            ],
          },
        },
      },
    });
    const notice = JSON.parse(t.err())._notice;
    expect(notice.data.plan.skills.tools).toEqual([
      { tool: 'sample', origin: 'patch', status: 'planned', vector },
    ]);
    const error = new DevkitError('permission', 'SKILL_WRITE_DENIED', 'denied', {
      nextSteps: failure.next_steps,
    });
    t.renderer.error(error);
    expect(JSON.parse(t.err().trim().split('\n').at(-1)!)).toEqual(toEnvelope(error));
  });

  it('summarizes sync collections and their stage trailer together', () => {
    const t = render({ report: 'sync' });
    t.renderer.list(report.sync.items, {
      trailer: {
        summary: report.sync.summary,
        stages: report.sync.stages,
        stage_details: report.sync.stage_details,
      },
    });
    expect(JSON.parse(t.out())).toMatchObject({
      items: [report.sync.items[70]],
      has_more: false,
      omitted: { items: 70 },
      stages: report.sync.stages,
    });
  });
});
