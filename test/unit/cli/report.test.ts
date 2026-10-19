import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createRenderer, type RenderOptions } from '../../../src/cli/render/index.js';
import { DevkitError, toEnvelope } from '../../../src/domain/errors.js';
import {
  HARNESS_ACTIONS,
  HOOK_ACTIONS,
  harnessActionState,
  hookActionState,
} from '../../../src/domain/harness/actions.js';

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
  preparation: { state: 'incomplete' },
  registered: true,
  written: true,
  failed_phase: 'sync',
  next_steps: ['fx sync --only repos,docs --format json'],
  sync: {
    items: [
      ...Array.from({ length: 70 }, (_, i) => ({
        name: i === 0 ? 'not_implemented' : `sample-${i}`,
        path: `sample-${i}`,
        action: 'skip_unpicked',
        result: 'skipped',
        reason: 'not selected on this machine; select the repository before synchronizing it',
      })),
      { name: 'protected', action: 'skip_dirty', result: 'skipped', reason: 'keep local edits' },
      { name: 'api', action: 'clone', result: 'done' },
    ],
    summary: { done: 1, failed: 0, skipped: 71 },
    stages: { skills: { status: 'failed' }, hooks: { status: 'not_started' } },
    stage_details: {
      setup: {
        items: [
          { id: 'sample.local', tool: 'sample', kind: 'run', result: 'done' },
          { id: 'sample.auth', tool: 'sample', kind: 'run', result: 'handoff' },
        ],
        problems: [],
      },
      skills: { tools: [{ tool: 'sample', vector, status: 'failed', failure }] },
      docs: {
        failure,
        files: [
          { path: '/workspace/AGENTS.md', action: 'created', result: 'done' },
          { path: '/workspace/CLAUDE.md', action: 'removed', result: 'failed', failure },
        ],
      },
    },
  },
};

describe('workflow JSON summaries', () => {
  it('retains initialization plans in the default view, including normal planned installs', () => {
    const output = render();
    const plan = {
      repositories: [{ name: 'api', action: 'clone' }],
      resources: { tools: [{ name: 'tool', action: 'install_if_missing', scope: 'global' }] },
    };
    output.renderer.record({ operation: 'preview', plan, written: false });
    expect(JSON.parse(output.out())).toMatchObject({ plan, omitted: {} });
  });

  it('cuts a 70-unpicked report by 70% without losing protected work, stages or exact recovery', () => {
    const summary = render();
    const details = render({ details: true });
    summary.renderer.record(report);
    details.renderer.record(report);
    const result = JSON.parse(summary.out());
    expect(result).toMatchObject({
      operation: 'apply',
      preparation: { state: 'incomplete' },
      failed_phase: 'sync',
      omitted: { 'sync.items': 70 },
      sync: {
        items: [report.sync.items[70], report.sync.items[71]],
        stages: report.sync.stages,
        stage_details: report.sync.stage_details,
      },
      next_steps: report.next_steps,
    });
    expect(JSON.parse(details.out())).toEqual(report);
    expect(Buffer.byteLength(summary.out())).toBeLessThan(Buffer.byteLength(details.out()) * 0.3);
  });

  it('keeps every warning and failure while omitting successful findings and large evidence', () => {
    const t = render({ report: 'doctor' });
    t.renderer.record({
      preparation: { state: 'incomplete' },
      coverage: 'incomplete',
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
      preparation: { state: 'incomplete' },
      coverage: 'incomplete',
      omitted: { findings: 1, 'findings.evidence': 2 },
    });
    expect(out.findings).toHaveLength(2);
    expect(out.findings[0].handoff.summary).toBe('need access');
    expect(out.findings[1].fix).toBe('inspect');
  });

  it('projects explicit fields from the full result and leaves NDJSON and fact queries full', () => {
    const projected = render({ fields: ['sync.items.name'] });
    projected.renderer.record(report);
    expect(JSON.parse(projected.out())['sync.items.name']).toHaveLength(72);
    const ndjson = render({}, 'ndjson');
    ndjson.renderer.record(report);
    expect(JSON.parse(ndjson.out())).toEqual(report);
    const facts = render({ report: undefined });
    facts.renderer.record(report);
    expect(JSON.parse(facts.out())).toEqual(report);
  });

  it('retains error recovery even when a report uses field projection', () => {
    const t = render({ fields: ['preparation.state'] });
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
      omitted: { items: 71 },
      stages: report.sync.stages,
    });
  });
});

describe('projection rows in a workflow summary', () => {
  it('keeps exactly the rows whose action left the entry unfinished', () => {
    const t = render({ report: 'sync' });
    t.renderer.record({
      operation: 'apply',
      stage_details: {
        mcp: {
          items: HARNESS_ACTIONS.map((action) => ({
            key: action,
            kind: 'mcp',
            name: 'tracker',
            agents: ['sample-agent'],
            path: '.sample/mcp.json',
            action,
            variables: [],
            handoff: null,
          })),
        },
        hooks: {
          items: HOOK_ACTIONS.map((action) => ({
            activation: 'unsupported',
            handoff: null,
            agent: 'sample-agent',
            path: '.sample/hooks.json',
            context: null,
            action,
            command: null,
          })),
        },
      },
    });
    const out = JSON.parse(t.out());
    const kept = (stage: 'mcp' | 'hooks'): unknown[] =>
      out.stage_details[stage].items.map((row: { action: unknown }) => row.action);
    const blockedHarness = HARNESS_ACTIONS.filter((a) => harnessActionState(a) === 'blocked');
    const blockedHooks = HOOK_ACTIONS.filter((a) => hookActionState(a) === 'blocked');
    expect(kept('mcp')).toEqual(blockedHarness);
    expect(kept('hooks')).toEqual(blockedHooks);
    expect(out.omitted).toEqual({
      'stage_details.mcp.items': HARNESS_ACTIONS.length - blockedHarness.length,
      'stage_details.hooks.items': HOOK_ACTIONS.length - blockedHooks.length,
    });
  });
});
