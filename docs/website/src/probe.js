// The homepage's workspace probe snaps pointer input to manifest-like coordinates.
// It draws only while input settles; no coordinates leave this page or are retained.
(() => {
  const hero = document.querySelector('.hero');
  const canvas = hero?.querySelector('.workspace-probe');
  const context = canvas?.getContext('2d');
  if (!context) return;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const terminal = hero.querySelector('.terminal');
  const orbit = hero.querySelector('.terminal-orbit');
  const readout = hero.querySelector('[data-probe-readout]');
  const caption = readout.textContent;
  const step = 52;
  let bounds;
  let terminalBounds;
  let frame = 0;
  let active = false;
  let current = null;
  let target = null;
  let previousTime = 0;
  let lastCell = '';
  const allowed = () =>
    finePointer.matches &&
    !reducedMotion.matches &&
    !document.documentElement.classList.contains('no-motion') &&
    !document.hidden;

  function measure() {
    bounds = hero.getBoundingClientRect();
    const box = terminal.getBoundingClientRect();
    terminalBounds = {
      x: box.left - bounds.left,
      y: box.top - bounds.top,
      width: box.width,
      height: box.height,
    };
    const scale = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(bounds.width * scale);
    canvas.height = Math.round(bounds.height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
  }
  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    active = false;
    current = null;
    target = null;
    lastCell = '';
    hero.classList.remove('is-probing');
    context.clearRect(0, 0, canvas.width, canvas.height);
    orbit.style.removeProperty('translate');
    terminal.style.removeProperty('--probe-edge');
    readout.textContent = caption;
  }
  function segment(points, color, dashed = false) {
    context.strokeStyle = color;
    context.lineWidth = 1;
    context.setLineDash(dashed ? [3, 7] : []);
    context.beginPath();
    points.forEach(([x, y], index) =>
      index ? context.lineTo(x + 0.5, y + 0.5) : context.moveTo(x + 0.5, y + 0.5),
    );
    context.stroke();
    context.setLineDash([]);
  }
  function bracket(x, y, length = 7) {
    const inset = step / 2 - 5;
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const cornerX = x + dx * inset;
      const cornerY = y + dy * inset;
      segment(
        [
          [cornerX - dx * length, cornerY],
          [cornerX, cornerY],
          [cornerX, cornerY - dy * length],
        ],
        '#c4f36b8c',
      );
    }
  }
  function draw() {
    const x = Math.round(current.x / step) * step;
    const y = Math.round(current.y / step) * step;
    context.clearRect(0, 0, bounds.width, bounds.height);
    // Orthogonal traces follow the same lattice as the static background.
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.abs(dx) + Math.abs(dy) > 3) continue;
        const nx = x + dx * step;
        const ny = y + dy * step;
        const alpha = Math.max(0.08, 0.3 - Math.hypot(nx - current.x, ny - current.y) / 560);
        const color = `rgba(196,243,107,${alpha})`;
        segment(
          [
            [nx - 3, ny],
            [nx + 3, ny],
          ],
          color,
        );
        segment(
          [
            [nx, ny - 3],
            [nx, ny + 3],
          ],
          color,
        );
      }
    }
    const originX = Math.floor((terminalBounds.x - 12) / step) * step;
    const originY = Math.floor(terminalBounds.y / step) * step;
    segment(
      [
        [originX, originY],
        [originX, y],
        [x, y],
      ],
      '#c4f36b40',
      true,
    );
    context.strokeStyle = '#c4f36b80';
    context.strokeRect(originX - 3.5, originY - 3.5, 7, 7);
    bracket(x, y);
    // A tiny off-grid cursor joins the snapped cell: the difference is intentional.
    segment(
      [
        [x, y],
        [current.x, current.y],
      ],
      '#c4f36b25',
    );
    const cell = `${String(Math.round(x / step)).padStart(2, '0')}:${String(Math.round(y / step)).padStart(2, '0')}`;
    if (lastCell !== cell) {
      readout.textContent = `WORKSPACE[${cell}] / POINTER PROBE`;
      lastCell = cell;
    }
    const offsetX = (current.x / bounds.width - 0.5) * 12;
    const offsetY = (current.y / bounds.height - 0.5) * 8;
    orbit.style.translate = `${offsetX.toFixed(2)}px ${offsetY.toFixed(2)}px`;
    const proximity = Math.max(
      0,
      1 - Math.hypot(current.x - terminalBounds.x, current.y - terminalBounds.y) / 700,
    );
    terminal.style.setProperty(
      '--probe-edge',
      `rgba(196,243,107,${(0.2 + proximity * 0.35).toFixed(2)})`,
    );
  }
  function tick(time) {
    frame = 0;
    if (!active || !allowed()) {
      stop();
      return;
    }
    const elapsed = Math.min(time - previousTime || 16, 48);
    previousTime = time;
    const follow = 1 - Math.exp(-elapsed / 55);
    current.x += (target.x - current.x) * follow;
    current.y += (target.y - current.y) * follow;
    const settled = Math.hypot(target.x - current.x, target.y - current.y) <= 0.2;
    if (settled) current = { ...target };
    draw();
    if (!settled) frame = requestAnimationFrame(tick);
  }
  function move(event) {
    if (!allowed() || event.pointerType === 'touch') {
      stop();
      return;
    }
    // Read layout once per entry; scrolling, resizing and tab exit invalidate it.
    if (!active) {
      measure();
      active = true;
      hero.classList.add('is-probing');
    }
    target = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    current ??= { ...target };
    if (!frame) {
      previousTime = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }
  hero.addEventListener('pointermove', move, { passive: true });
  hero.addEventListener('pointerleave', stop);
  hero.addEventListener('pointercancel', stop);
  window.addEventListener('scroll', stop, { passive: true });
  window.addEventListener('resize', stop, { passive: true });
  window.addEventListener('blur', stop);
  document.addEventListener('visibilitychange', stop);
  document.addEventListener('fx:motionchange', stop);
  finePointer.addEventListener('change', stop);
  reducedMotion.addEventListener('change', stop);
})();
