import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { PLAIN } from '../../../src/cli/render/display.js';
import { createRenderer, FORMATS } from '../../../src/cli/render/index.js';
import { DevkitError } from '../../../src/domain/errors.js';
import { FakeTerminal, tagged } from '../../fakes/fake-terminal.js';

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

  it('sets a trailer apart from its table, and adds nothing when the trailer says nothing', () => {
    const t = io();
    const r = createRenderer('human', t.io);
    r.list([{ name: 'a' }], { trailer: { workspace: 'work', stage_details: { docs: 1 } } });
    r.list([{ name: 'a' }], { trailer: { stage_details: { docs: 1 } } });
    expect(t.out()).toBe('name\n----\na\n\nworkspace  work\nname\n----\na\n');
  });

  it('renders a notice as a labelled line with its silence hint', () => {
    const t = io();
    createRenderer('human', t.io).notice({ ...notice, nextSteps: ['fx self update'] });
    expect(t.err()).toContain('notice UPDATE_AVAILABLE: fx 0.2.0 is available');
    expect(t.err()).toContain('fx self update');
    expect(t.err()).toContain('FX_NO_UPDATE_CHECK=1');
  });
});

describe('human renderer on a terminal', () => {
  const terminals = (env: NodeJS.ProcessEnv = {}) => {
    const out = new FakeTerminal(60);
    const err = new FakeTerminal(60);
    return {
      io: { out, err, env, platform: 'darwin' as const },
      out: () => out.text(),
      err: () => err.text(),
    };
  };

  it('decorates stdout and stderr and sets a trailer apart from its table', () => {
    const t = terminals();
    const r = createRenderer('human', t.io);
    r.list([{ name: 'api', state: 'ready' }], { trailer: { workspace: 'work' } });
    r.notice({ code: 'SCOPE_UNSET', message: 'Everything is selected' });
    expect(tagged(t.out())).toBe(
      [
        '<strong>name</>  <strong>state</>',
        '<quiet>----</>  <quiet>-----</>',
        'api   <ok>ready</>',
        '',
        '<quiet>workspace</>  work',
        '',
      ].join('\n'),
    );
    expect(tagged(t.err())).toBe('<accent>●</> <quiet>SCOPE_UNSET:</> Everything is selected\n');
  });

  it('prints an error as text for the person watching', () => {
    const t = terminals();
    createRenderer('human', t.io).error(
      new DevkitError('usage', 'BAD_FLAG', 'no such flag', { nextSteps: ['fx --help'] }),
    );
    expect(tagged(t.err())).toBe(
      [
        '<fail>✗</> <quiet>BAD_FLAG:</> <strong>no such flag</>',
        '  The command was invoked incorrectly.',
        '  <quiet>→</> fx --help',
        '',
      ].join('\n'),
    );
  });

  it('tells the person about a field no row has; a program still reads it structured', () => {
    const watched = terminals();
    createRenderer('human', watched.io, { fields: ['name', 'nope'] }).list([{ name: 'a' }]);
    expect(tagged(watched.err())).toBe(
      '<accent>●</> <quiet>FIELDS_UNMATCHED:</> Fields absent from this result (possibly optional): nope\n' +
        '  <quiet>→</> Inspect the result without --fields.\n',
    );
    const piped = io();
    createRenderer('human', piped.io, { fields: ['name', 'nope'] }).list([{ name: 'a' }]);
    expect(JSON.parse(piped.err())._notice.code).toBe('FIELDS_UNMATCHED');
  });

  it('keeps an error text, its steps still marked, when the terminal has no colour', () => {
    const t = terminals({ NO_COLOR: '1' });
    createRenderer('human', t.io).error(
      new DevkitError('usage', 'BAD_FLAG', 'no such flag', { nextSteps: ['fx --help'] }),
    );
    expect(t.err()).toBe(
      [
        '✗ BAD_FLAG: no such flag',
        '  The command was invoked incorrectly.',
        '  → fx --help',
        '',
      ].join('\n'),
    );
  });

  it('decides each stream on its own: piped data stays plain beside a decorated stderr', () => {
    const out = sink();
    const err = new FakeTerminal();
    const r = createRenderer('human', { out: out.stream, err, env: {}, platform: 'darwin' });
    r.list([{ name: 'api', state: 'ready' }]);
    r.notice({ code: 'SCOPE_UNSET', message: 'Everything is selected' });
    expect(out.text()).toBe('name  state\n----  -----\napi   ready\n');
    expect(err.text()).toContain('\u001b[');
    expect(r.display.out.interactive).toBe(false);
    expect(r.display.err.interactive).toBe(true);
  });

  it('keeps data plain and the error an envelope when only stdout faces a person', () => {
    const out = new FakeTerminal();
    const err = sink();
    const r = createRenderer('human', { out, err: err.stream, env: {}, platform: 'darwin' });
    r.error(new DevkitError('usage', 'BAD_FLAG', 'no such flag'));
    expect(JSON.parse(err.text()).error.code).toBe('BAD_FLAG');
  });

  it('never decorates a machine format, and keeps its error an envelope', () => {
    for (const format of ['json', 'ndjson'] as const) {
      const t = terminals();
      const r = createRenderer(format, t.io, { verbose: true });
      r.list([{ name: 'api', state: 'ready' }]);
      r.notice({ code: 'SCOPE_UNSET', message: 'Everything is selected' });
      r.progress({ id: 'api', state: 'done' });
      r.emit({ kind: 'process', phase: 'version probe', exit_code: 1 });
      r.error(new DevkitError('usage', 'BAD_FLAG', 'no such flag'));
      expect(t.out() + t.err()).not.toMatch(/[\u001b✓✗→●…]/);
      expect(r.display).toEqual({ out: PLAIN, err: PLAIN });
      expect(JSON.parse(t.err().trim().split('\n').at(-1)!).error.code).toBe('BAD_FLAG');
    }
  });
});

describe('every renderer', () => {
  it('writes errors as a JSON envelope on any stderr that is not a terminal', () => {
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
