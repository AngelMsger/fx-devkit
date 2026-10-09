// Decoration is a property of the stream: a terminal gets colour, symbols and a width;
// everything a program may read gets none of them, whatever the environment asks for.
import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { displayOf, PLAIN } from '../../../src/cli/render/display.js';
import { FakeTerminal, tagged } from '../../fakes/fake-terminal.js';

const pipe = (): Writable => new Writable({ write: (_chunk, _encoding, done) => done() });

describe('a stream that is not a terminal', () => {
  it('is plain even when the environment forces colour', () => {
    for (const env of [{}, { TERM: 'xterm-256color' }, { FORCE_COLOR: '1' }, { FORCE_COLOR: '3' }])
      expect(displayOf(pipe(), env, 'darwin')).toBe(PLAIN);
  });

  it('paints nothing, marks nothing and never shortens', () => {
    expect(PLAIN.interactive).toBe(false);
    expect(PLAIN.paint('fail', 'blocked')).toBe('blocked');
    expect(PLAIN.mark('ok')).toBe('');
    expect(PLAIN.mark()).toBe('');
    expect(PLAIN.label).toEqual({ notice: 'notice', error: 'error' });
    expect(PLAIN.room()).toBe(Infinity);
    expect(PLAIN.clip('a long reason', 4)).toBe('a long reason');
    expect(PLAIN.wrap('a long\nreason', 4)).toEqual(['a long\nreason']);
  });
});

describe('a terminal', () => {
  const terminal = displayOf(new FakeTerminal(96), {}, 'darwin');

  it('paints roles and marks lines', () => {
    expect(terminal.interactive).toBe(true);
    expect(tagged(terminal.paint('strong', 'name'))).toBe('<strong>name</>');
    expect(tagged(terminal.mark('fail'))).toBe('<fail>✗</> ');
    expect(tagged(terminal.mark('step'))).toBe('<quiet>→</> ');
    expect(terminal.mark()).toBe('  ');
    expect(terminal.label).toEqual({ notice: '●', error: '✗' });
  });

  it('leaves text without a role, and absent text, free of control sequences', () => {
    expect(terminal.paint(undefined, 'dev')).toBe('dev');
    expect(terminal.paint('quiet', '')).toBe('');
  });

  it('keeps the last column free and shortens to the room that is left', () => {
    expect(terminal.room()).toBe(95);
    expect(terminal.room(20)).toBe(75);
    expect(terminal.clip('fx-example-api', 8)).toBe('fx-exam…');
    expect(terminal.clip('api', 8)).toBe('api');
    expect(terminal.wrap('a long reason', 6)).toEqual(['a long', 'reason']);
  });

  it('shortens nothing when it reports no width', () => {
    const unsized = displayOf(new FakeTerminal(0), {}, 'darwin');
    expect(unsized.room()).toBe(Infinity);
    expect(unsized.clip('a long reason', 4)).toBe('a long reason');
    expect(unsized.wrap('a long reason', 4)).toEqual(['a long reason']);
  });

  it('loses only its colour to NO_COLOR and a dumb terminal', () => {
    for (const env of [{ NO_COLOR: '1' }, { TERM: 'dumb' }]) {
      const display = displayOf(new FakeTerminal(80), env, 'darwin');
      expect(display.paint('fail', 'blocked')).toBe('blocked');
      expect(display.mark('fail')).toBe('✗ ');
      expect(display.room()).toBe(79);
      expect(display.interactive).toBe(true);
    }
  });

  it('keeps colour but not symbols where the console cannot draw them', () => {
    const legacy = displayOf(new FakeTerminal(), {}, 'win32');
    expect(tagged(legacy.paint('ok', 'ready'))).toBe('<ok>ready</>');
    expect(legacy.mark('ok')).toBe('');
    expect(legacy.label).toEqual(PLAIN.label);
    expect(legacy.clip('fx-example-api', 8)).toBe('fx-ex...');
    expect(displayOf(new FakeTerminal(), { WT_SESSION: '1' }, 'win32').mark()).toBe('  ');
    expect(displayOf(new FakeTerminal(), { TERM: 'linux' }, 'linux').mark('ok')).toBe('');
  });
});
