import { describe, expect, it } from 'vitest';

import { releaseText } from '../../../src/cli/release-view.js';
import { PLAIN } from '../../../src/cli/render/display.js';
import { createRenderer, type RenderOptions } from '../../../src/cli/render/index.js';
import { DevkitError, toEnvelope } from '../../../src/domain/errors.js';
import { HARNESS_ACTIONS, HOOK_ACTIONS } from '../../../src/domain/harness/actions.js';
import { errorsFinding } from '../../../src/domain/release/errors.js';
import { report as summarizeReport } from '../../../src/domain/report.js';
import { CaptureStream } from '../../fakes/capture-stream.js';

function render(options: RenderOptions = {}, format: 'json' | 'ndjson' = 'json') {
  const out = new CaptureStream();
  const err = new CaptureStream();
  return {
    renderer: createRenderer(format, { out, err }, { report: 'init', ...options }),
    out: () => out.text(),
    err: () => err.text(),
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
          failure,
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
    expect(out.findings[0].failure).toEqual(failure);
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
  it('keeps the rows of entries fx could not manage and drops every other one', () => {
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
    expect(kept('mcp')).toEqual(['untrusted', 'foreign', 'missing_variables', 'conflict']);
    expect(kept('hooks')).toEqual(['foreign', 'invalid', 'busy', 'conflict']);
    expect(out.omitted).toEqual({
      'stage_details.mcp.items': 5,
      'stage_details.hooks.items': 6,
    });
  });
});

it('summarizes large historical comparisons without hiding failures or truncating explicit details', () => {
  const source = {
    repos: [
      {
        name: 'a',
        baseline_evidence: {
          commits: [{ sha: 'a1' }, { sha: 'a2' }],
          coverage: 'checked',
          failures: [],
        },
      },
      {
        name: 'b',
        baseline_evidence: {
          commits: [{ sha: 'b1' }],
          coverage: 'incomplete',
          failures: [failure],
        },
      },
    ],
  };
  const summary = render({ report: 'release:check' });
  const details = render({ report: 'release:check', details: true });
  const projected = render({
    report: 'release:check',
    fields: ['repos.baseline_evidence.commits'],
  });
  summary.renderer.record(source);
  details.renderer.record(source);
  projected.renderer.record(source);
  expect(JSON.parse(summary.out())).toMatchObject({
    repos: [
      { baseline_evidence: { commits_count: 2, coverage: 'checked' } },
      { baseline_evidence: { commits_count: 1, coverage: 'incomplete', failures: [failure] } },
    ],
    omitted: { 'repos.baseline_evidence.commits': 3 },
  });
  expect(JSON.parse(details.out())).toEqual(source);
  expect(JSON.parse(projected.out())['repos.baseline_evidence.commits']).toEqual([
    [{ sha: 'a1' }, { sha: 'a2' }],
    [{ sha: 'b1' }],
  ]);
});

it('keeps partial error-query recovery in compact JSON and the human release view', () => {
  const throttle = toEnvelope(
    new DevkitError('rate_limit', 'THROTTLED', 'Tracker rate limited', {
      nextSteps: ['Wait, then retry the same absolute range.'],
    }),
  ).error;
  const timeout = toEnvelope(
    new DevkitError('network', 'TIMEOUT', 'Tracker request timed out', {
      nextSteps: ['Check connectivity, then retry.'],
    }),
  ).error;
  const baseIssue = {
    id: '1',
    shortId: 'EXAMPLE-1',
    title: 'Example',
    level: 'error',
    firstSeen: '2026-09-01T00:00:00Z',
    lastSeen: null,
    count: 1,
    url: null,
    culprit: null,
  };
  const issues = [baseIssue, { ...baseIssue, id: '2', firstSeen: null }];
  const finding = errorsFinding({
    repo: 'example',
    env: 'test',
    slug: 'example',
    label: 'Tracker',
    since: '14d',
    now: new Date('2026-09-03T00:00:00Z'),
    issues,
    capped: false,
    page: {
      issues,
      more: false,
      coverage: 'incomplete',
      failures: [
        { stage: 'detail', issue_id: '2', error: throttle },
        { stage: 'detail', issue_id: '3', error: timeout },
      ],
    },
  });
  const result = { ...summarizeReport(['errors'], [finding]), repos: [] };
  const output = render({ report: 'release:check' });
  output.renderer.record(result);
  const summary = JSON.parse(output.out());
  expect(summary).toMatchObject({
    complete: false,
    findings: [
      {
        level: 'fail',
        coverage: 'incomplete',
        failure: throttle,
        failures: [throttle, timeout],
        fix: throttle.next_steps[0],
      },
    ],
  });
  expect(summary.findings[0].evidence).toBeUndefined();
  expect(summary.findings[0].message).toContain('evidence is incomplete');
  const text = releaseText(result, { display: PLAIN, details: false });
  expect(text).toContain('evidence is incomplete');
  expect(text).toContain(throttle.next_steps[0]);
  expect(finding.evidence).toMatchObject({
    error_evidence: {
      failures: [
        { stage: 'detail', issue_id: '2', error: throttle },
        { stage: 'detail', issue_id: '3', error: timeout },
      ],
    },
  });
});
