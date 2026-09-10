import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createRenderer, FORMATS } from '../../../src/cli/render/index.js';
import { DevkitError } from '../../../src/domain/errors.js';

function sink(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  return { stream, text: () => chunks.join('') };
}

function io() {
  const out = sink();
  const err = sink();
  return { io: { out: out.stream, err: err.stream }, out: out.text, err: err.text };
}

const notice = {
  code: 'UPDATE_AVAILABLE',
  message: 'fx 0.2.0 is available',
  silence: 'FX_NO_UPDATE_CHECK=1',
};

describe('json renderer', () => {
  it('wraps a list in the family envelope and keeps stdout parseable next to a notice', () => {
    const t = io();
    const r = createRenderer('json', t.io);
    r.notice(notice);
    r.list([{ name: 'a' }], { hasMore: false });
    expect(JSON.parse(t.out())).toEqual({ items: [{ name: 'a' }], has_more: false });
    expect(JSON.parse(t.err())).toEqual({ _notice: notice });
  });

  it('folds a trailer into the envelope, and ndjson closes with it', () => {
    const t = io();
    createRenderer('json', t.io).list([{ name: 'a' }], { trailer: { stages: { docs: 1 } } });
    expect(JSON.parse(t.out())).toEqual({
      items: [{ name: 'a' }],
      has_more: false,
      stages: { docs: 1 },
    });
    const n = io();
    createRenderer('ndjson', n.io).list([{ name: 'a' }], { trailer: { stages: { docs: 1 } } });
    expect(
      n
        .out()
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l)),
    ).toEqual([{ name: 'a' }, { _trailer: { stages: { docs: 1 } } }]);
  });

  it('includes next only when there is one', () => {
    const t = io();
    createRenderer('json', t.io).list([], { hasMore: true, next: 'p2' });
    expect(JSON.parse(t.out())).toEqual({ items: [], has_more: true, next: 'p2' });
  });
});

describe('ndjson renderer', () => {
  it('emits one object per line and notices as _notice lines', () => {
    const t = io();
    const r = createRenderer('ndjson', t.io);
    r.list([{ n: 1 }, { n: 2 }]);
    r.notice(notice);
    expect(
      t
        .out()
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l)),
    ).toEqual([{ n: 1 }, { n: 2 }]);
    expect(JSON.parse(t.err())).toEqual({ _notice: notice });
  });
});

describe('human renderer', () => {
  it('names and aligns list columns without control sequences', () => {
    const t = io();
    createRenderer('human', t.io).list([{ name: 'fx-example-api', branch: 'dev' }], {
      columns: ['name', 'branch'],
    });
    expect(t.out().split('\n').slice(0, 2)).toEqual([
      'name            branch',
      '--------------  ------',
    ]);
    expect(t.out()).toMatch(/fx-example-api\s+dev/);
    expect(t.out()).not.toMatch(/\u001b/);
  });

  it('omits list headings only when the caller requests headerless human output', () => {
    const t = io();
    createRenderer('human', t.io, { noHeader: true }).list(
      [{ name: 'fx-example-api', branch: 'dev' }],
      {
        columns: ['name', 'branch'],
      },
    );
    expect(t.out()).toBe('fx-example-api  dev\n');
  });

  it('uses requested fields as human columns instead of retaining empty command columns', () => {
    const t = io();
    createRenderer('human', t.io, { fields: ['name'] }).list(
      [{ name: 'fx-example-api', branch: 'dev' }],
      {
        columns: ['name', 'branch'],
      },
    );
    expect(t.out()).toBe('name\n--------------\nfx-example-api\n');
  });

  it('renders a list of objects in a record one item per line', () => {
    const t = io();
    createRenderer('human', t.io).record({
      name: 'a',
      owners: [{ scenario: 'Core', devLead: 'bob' }],
      tags: ['x', 'y'],
    });
    expect(t.out()).toBe('name    a\nowners\n  - scenario: Core, devLead: bob\ntags    x,y\n');
  });

  it('lets a command describe one key of a record in its own lines', () => {
    const t = io();
    createRenderer('human', t.io).record(
      { name: 'a', owners: [{ scenario: 'Core' }] },
      { describe: { owners: (v) => [`${(v as object[]).length} scenario`] } },
    );
    expect(t.out()).toBe('name    a\nowners\n  1 scenario\n');
  });

  it('renders a notice as a labelled line with its silence hint', () => {
    const t = io();
    createRenderer('human', t.io).notice({ ...notice, nextSteps: ['fx self update'] });
    expect(t.err()).toContain('notice UPDATE_AVAILABLE: fx 0.2.0 is available');
    expect(t.err()).toContain('fx self update');
    expect(t.err()).toContain('FX_NO_UPDATE_CHECK=1');
  });
});

describe('every renderer', () => {
  it('writes errors as a JSON envelope on stderr and nothing on stdout', () => {
    for (const format of FORMATS) {
      const t = io();
      createRenderer(format, t.io).error(new DevkitError('usage', 'BAD_FLAG', 'no such flag'));
      expect(t.out()).toBe('');
      expect(JSON.parse(t.err()).error.code).toBe('BAD_FLAG');
    }
  });

  it('projects records and list items to the requested fields', () => {
    for (const format of FORMATS) {
      const t = io();
      const r = createRenderer(format, t.io, { fields: ['name', 'obs.svc'] });
      r.list([
        { name: 'fx-example-api', branch: 'dev', obs: { svc: 'example-api', covered: true } },
      ]);
      expect(t.out()).toContain('fx-example-api');
      expect(t.out()).toContain('example-api');
      expect(t.out()).not.toContain('dev');
      expect(t.out()).not.toContain('covered');
    }
  });

  it('drops notices under quiet but never errors', () => {
    for (const format of FORMATS) {
      const t = io();
      const r = createRenderer(format, t.io, { quiet: true });
      r.notice(notice);
      expect(t.err()).toBe('');
      r.error(new DevkitError('config', 'CONFIG_INVALID', 'bad'));
      expect(t.err()).not.toBe('');
    }
  });

  it('emits diagnostics only when verbose, without sending them to stdout', () => {
    for (const format of FORMATS) {
      const quiet = io();
      createRenderer(format, quiet.io).emit({
        kind: 'process',
        phase: 'version probe',
        vector: ['tool', '--version'],
        exit_code: 1,
      });
      expect(quiet.out()).toBe('');
      expect(quiet.err()).toBe('');

      const verbose = io();
      createRenderer(format, verbose.io, { verbose: true }).emit({
        kind: 'process',
        phase: 'version probe',
        vector: ['tool', '--version'],
        exit_code: 1,
      });
      expect(verbose.out()).toBe('');
      expect(verbose.err()).toContain('version probe');
    }
  });
});

describe('progress', () => {
  it('goes to stderr as a _progress record in json, as a line in human, and is silenced by quiet', () => {
    const event = { id: 'fx-example-api', state: 'done' as const, detail: 'fast_forward' };
    const j = io();
    createRenderer('json', j.io).progress(event);
    expect(j.out()).toBe('');
    expect(JSON.parse(j.err())).toEqual({ _progress: event });
    const h = io();
    createRenderer('human', h.io).progress(event);
    expect(h.err()).toContain('fx-example-api');
    expect(h.err()).toContain('fast_forward');
    const q = io();
    createRenderer('human', q.io, { quiet: true }).progress(event);
    expect(q.err()).toBe('');
  });
});
