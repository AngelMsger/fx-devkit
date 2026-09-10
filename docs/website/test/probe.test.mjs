// Exercise the pointer probe's scheduling and accessibility boundaries without a browser.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../src/probe.js', import.meta.url), 'utf8');
function fixture({ fine = true, reduced = false, canvasAvailable = true } = {}) {
  const frames = new Map();
  let clock = 0;
  let sequence = 0;
  let draws = 0;
  const events = () => {
    const handlers = new Map();
    return {
      addEventListener: (name, callback) => handlers.set(name, callback),
      emit: (name, event = {}) => handlers.get(name)?.(event),
    };
  };
  const properties = new Map();
  const classes = new Set();
  const classList = {
    contains: (value) => classes.has(value),
    add: (value) => classes.add(value),
    remove: (value) => classes.delete(value),
  };
  const style = {
    setProperty: (name, value) => properties.set(name, value),
    removeProperty: (name) => {
      properties.delete(name);
      delete style[name];
    },
  };
  const context = new Proxy(
    {},
    { get: (_, name) => (name === 'stroke' ? () => draws++ : () => {}) },
  );
  const canvas = { getContext: () => (canvasAvailable ? context : null) };
  const readout = { textContent: 'ORIGINAL CAPTION' };
  const terminal = {
    style,
    getBoundingClientRect: () => ({ left: 600, top: 180, width: 400, height: 400 }),
  };
  const hero = {
    ...events(),
    classList,
    getBoundingClientRect: () => ({ left: 0, top: 80, width: 1100, height: 700 }),
    querySelector: (selector) =>
      ({
        '.workspace-probe': canvas,
        '.terminal': terminal,
        '.terminal-orbit': { style },
        '[data-probe-readout]': readout,
      })[selector],
  };
  const doc = {
    ...events(),
    hidden: false,
    documentElement: { classList },
    querySelector: () => hero,
  };
  const win = events();
  const pointer = { ...events(), matches: fine };
  const motion = { ...events(), matches: reduced };
  vm.runInNewContext(source, {
    document: doc,
    window: win,
    matchMedia: (query) => (query.includes('prefers-reduced-motion') ? motion : pointer),
    devicePixelRatio: 3,
    performance: { now: () => clock },
    requestAnimationFrame: (callback) => {
      frames.set(++sequence, callback);
      return sequence;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  const move = (x = 300, y = 300, pointerType = 'mouse') =>
    hero.emit('pointermove', { clientX: x, clientY: y, pointerType });
  const flush = () => {
    for (let n = 0; frames.size && n < 200; n++) {
      clock += 16;
      const pending = [...frames];
      frames.clear();
      pending.forEach(([, callback]) => callback(clock));
    }
    assert.equal(frames.size, 0, 'The animation must become idle');
  };
  return {
    frames,
    hero,
    doc,
    win,
    pointer,
    motion,
    move,
    flush,
    readout,
    properties,
    canvas,
    classList,
    get draws() {
      return draws;
    },
  };
}
test('coalesces pointer events, caps resolution, and becomes idle after settling', () => {
  const f = fixture();
  f.move();
  f.move(800, 450);
  f.move(900, 500);
  assert.equal(f.frames.size, 1);
  f.flush();
  assert.ok(f.draws > 0);
  assert.equal(f.canvas.width, 2200);
  assert.match(f.readout.textContent, /WORKSPACE\[17:08\]/);
});
test('touch, coarse pointers, reduced motion and unavailable canvas do not animate', () => {
  for (const options of [{ fine: false }, { reduced: true }, { canvasAvailable: false }]) {
    const f = fixture(options);
    f.move();
    assert.equal(f.frames.size, 0);
    assert.equal(f.readout.textContent, 'ORIGINAL CAPTION');
  }
  const f = fixture();
  f.move(20, 20, 'touch');
  assert.equal(f.frames.size, 0);
});
test('exit, scrolling, focus loss and motion pause cancel pending work and restore the frame', () => {
  const interruptions = [
    (f) => f.hero.emit('pointerleave'),
    (f) => f.hero.emit('pointercancel'),
    (f) => f.win.emit('scroll'),
    (f) => f.win.emit('resize'),
    (f) => f.win.emit('blur'),
    (f) => {
      f.doc.hidden = true;
      f.doc.emit('visibilitychange');
    },
    (f) => {
      f.classList.add('no-motion');
      f.doc.emit('fx:motionchange');
    },
    (f) => {
      f.motion.matches = true;
      f.motion.emit('change');
    },
  ];
  for (const interrupt of interruptions) {
    const f = fixture();
    f.move();
    f.flush();
    f.move(900, 500);
    interrupt(f);
    assert.equal(f.frames.size, 0);
    assert.equal(f.readout.textContent, 'ORIGINAL CAPTION');
    assert.equal(f.properties.size, 0);
    assert.equal(f.classList.contains('is-probing'), false);
  }
});
test('re-entering after scroll uses fresh layout and motion can resume', () => {
  const f = fixture();
  f.move();
  f.flush();
  f.win.emit('scroll');
  f.hero.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1100, height: 700 });
  f.move(300, 300);
  f.flush();
  assert.match(f.readout.textContent, /WORKSPACE\[06:06\]/);
  f.classList.add('no-motion');
  f.doc.emit('fx:motionchange');
  f.move();
  assert.equal(f.frames.size, 0);
  f.classList.remove('no-motion');
  f.doc.emit('fx:motionchange');
  f.move();
  f.flush();
  assert.ok(f.classList.contains('is-probing'));
});
