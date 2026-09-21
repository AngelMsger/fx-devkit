// Workflow fields select the complete report while fact-list projection keeps its row contract.
import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createRenderer, type RenderOptions, type Format } from '../../../src/cli/render/index.js';

function output(format: Format, options: RenderOptions) {
  let stdout = '';
  let stderr = '';
  const stream = (write: (chunk: string) => void): Writable =>
    new Writable({
      write(chunk, _encoding, done) {
        write(String(chunk));
        done();
      },
    });
  return {
    renderer: createRenderer(
      format,
      {
        out: stream((chunk) => {
          stdout += chunk;
        }),
        err: stream((chunk) => {
          stderr += chunk;
        }),
      },
      options,
    ),
    stdout: () => stdout,
    stderr: () => stderr,
    json: () => JSON.parse(stdout),
  };
}

const rows = [
  { name: 'api', action: 'clone' },
  { name: 'web', action: 'skip_unpicked', outcome: 'not selected' },
];
const trailer = {
  operation: 'preview',
  preparation: { state: 'planned' },
  summary: { done: 0 },
  stages: { docs: { planned: 2 } },
  stage_details: { tools: [{ coordinate: 'https://hidden.example.com/synthetic-detail' }] },
};

describe('workflow field projection', () => {
  it.each(['json', 'ndjson'] as const)(
    'projects top-level list report fields once in %s without hidden extras',
    (format) => {
      const target = output(format, {
        report: 'sync',
        fields: ['operation', 'preparation', 'items', 'summary'],
        details: true,
      });
      target.renderer.list(rows, { trailer });
      expect(target.json()).toEqual({
        operation: 'preview',
        preparation: { state: 'planned' },
        items: rows,
        summary: { done: 0 },
      });
      expect(target.stdout().trim().split('\n')).toHaveLength(1);
      expect(target.stdout()).not.toContain('hidden.example.com');
      expect(target.stdout()).not.toContain('stage_details');
      expect(target.stdout()).not.toContain('output_mode');
      expect(target.stderr()).toBe('');
    },
  );

  it.each(['json', 'ndjson', 'human'] as const)(
    'supports dotted item paths and one unknown-field notice in %s',
    (format) => {
      const target = output(format, {
        report: 'sync',
        fields: ['items.name', 'items.outcome', 'summary.done', 'unknown', 'items.unknown'],
      });
      target.renderer.list(rows, { trailer });
      expect(target.stdout()).toContain('api');
      expect(target.stdout()).toContain('web');
      expect(target.stdout()).not.toContain('hidden.example.com');
      expect(target.stdout()).not.toContain('clone');
      const notices = target
        .stderr()
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(notices).toHaveLength(1);
      expect(notices[0]._notice.message).toContain('unknown, items.unknown');
      if (format !== 'human')
        expect(target.json()).toEqual({
          'items.name': ['api', 'web'],
          'items.outcome': [null, 'not selected'],
          'summary.done': 0,
        });
    },
  );

  it.each(['json', 'ndjson', 'human'] as const)(
    'handles empty report rows and quiet unknown fields in %s',
    (format) => {
      const target = output(format, {
        report: 'sync',
        fields: ['operation', 'items.name', 'items.unknown', 'missing'],
        quiet: true,
      });
      target.renderer.list([], { trailer });
      expect(target.stderr()).toBe('');
      if (format !== 'human')
        expect(target.json()).toEqual({
          operation: 'preview',
          'items.name': [],
          'items.unknown': [],
        });
      const visible = output(format, { report: 'sync', fields: ['items.name', 'missing'] });
      visible.renderer.list([], { trailer });
      expect(JSON.parse(visible.stderr())._notice.message).toBe(
        'Fields absent from this result (possibly optional): missing',
      );
    },
  );

  it.each(['doctor', 'release'] as const)(
    'uses the whole %s report behind its human findings table',
    (report) => {
      const target = output('human', { report, fields: ['ok', 'summary.ok', 'findings.id'] });
      const fullReport = {
        ok: true,
        complete: true,
        summary: { ok: 1 },
        findings: [{ id: 'checked', level: 'ok', evidence: 'excluded' }],
        repairs: [],
      };
      target.renderer.list(fullReport.findings, {
        fullReport,
        columns: ['id', 'level', 'evidence'],
      });
      expect(target.stdout()).toContain('summary.ok');
      expect(target.stdout()).toContain('checked');
      expect(target.stdout()).not.toContain('excluded');
      expect(target.stdout()).not.toContain('complete');
      expect(target.stderr()).toBe('');
    },
  );

  it.each(['init', 'doctor', 'release'] as const)(
    'projects %s records from full values before summary filtering',
    (report) => {
      for (const details of [false, true]) {
        const target = output('json', {
          report,
          fields: ['findings.id', 'sync.items.name'],
          details,
        });
        target.renderer.record({
          findings: [{ id: 'normal', level: 'ok' }],
          sync: { items: rows },
          stage_details: trailer.stage_details,
        });
        expect(target.json()).toEqual({
          'findings.id': ['normal'],
          'sync.items.name': ['api', 'web'],
        });
        expect(target.stderr()).toBe('');
      }
    },
  );

  it('keeps unprojected NDJSON item/trailer streaming intact', () => {
    const target = output('ndjson', { report: 'sync' });
    target.renderer.list(rows, { trailer });
    expect(
      target
        .stdout()
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    ).toEqual([...rows, { _trailer: trailer }]);
  });
});

describe('fact-list field compatibility', () => {
  it.each(['json', 'ndjson', 'human'] as const)(
    'keeps per-row projections and diagnoses optional fields across all rows in %s',
    (format) => {
      const target = output(format, { fields: ['name', 'outcome'] });
      target.renderer.list(rows, { trailer: { workspace: 'work' } });
      expect(target.stdout()).toContain('api');
      expect(target.stdout()).toContain('web');
      expect(target.stdout()).not.toContain('action');
      expect(target.stderr()).toBe('');
      if (format === 'json')
        expect(target.json()).toEqual({
          items: [{ name: 'api' }, { name: 'web', outcome: 'not selected' }],
          has_more: false,
          workspace: 'work',
        });
      if (format === 'ndjson')
        expect(
          target
            .stdout()
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line)),
        ).toEqual([
          { name: 'api' },
          { name: 'web', outcome: 'not selected' },
          { _trailer: { workspace: 'work' } },
        ]);
    },
  );
});
