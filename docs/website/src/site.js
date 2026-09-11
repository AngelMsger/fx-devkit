// Progressive enhancement only: navigation and all documentation work without JS.
const status = document.querySelector('.copy-status');
const labels = JSON.parse(document.body.dataset.messages || '{}');
let statusTimer;
function announce(message) {
  if (!status) return;
  status.textContent = message;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    status.textContent = '';
  }, 2500);
}
for (const button of document.querySelectorAll('[data-copy], [data-code-copy]')) {
  button.addEventListener('click', async () => {
    const value =
      button.dataset.copy ?? button.closest('.code-block')?.querySelector('code')?.textContent;
    if (value === undefined) return;
    try {
      await navigator.clipboard.writeText(value);
      announce(labels.copied || 'Copied to clipboard');
    } catch {
      const code = button.closest('.code-block, .install-line')?.querySelector('code');
      if (code) {
        const range = document.createRange();
        range.selectNodeContents(code);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      announce(labels.copyFallback || 'Text selected. Use your keyboard to copy.');
    }
  });
}
const demos = {
  sync: [
    'fx sync --dry-run',
    '<span class="muted">Reading workspace manifest…</span>\n\n<span class="lime">✓</span> example-api       fast-forward\n<span class="lime">✓</span> example-web       up to date\n<span class="amber">↳</span> example-worker    skip · dirty\n\n<span class="muted">docs · skills · hooks</span>  ready\n\n<span class="lime">Plan ready.</span> Your changes stay yours.\n<span class="muted">Dry run. No files changed.</span>',
  ],
  where: [
    'fx where example-api --env test',
    '<span class="muted">Environment / test</span>\n\n<span class="lime">ci</span>             builds/example-api\n<span class="lime">log-store</span>      example_api\n<span class="lime">error-tracker</span>  example-api\n\n<span class="muted">Coordinates from the team manifest.</span>\n<span class="muted">Readiness from provider checks.</span>\n\n<span class="lime">One place to start investigating.</span>\n<span class="muted">fx prints commands. You run them.</span>',
  ],
  agent: [
    'fx can code-host --format json',
    '{\n  <span class="lime">"status"</span>: "ready",\n  <span class="lime">"capability"</span>: "code-host",\n  <span class="lime">"provider"</span>: "bitbucket-cli"\n}\n\n<span class="muted">Structured results. Explicit readiness.</span>\n<span class="muted">Shared Skills. Native host integration.</span>\n\n<span class="lime">Context your agent can act on.</span>\n<span class="muted">Illustrative output, abbreviated.</span>',
  ],
};
const tabs = [...document.querySelectorAll('[data-demo]')];
function selectTab(tab) {
  tabs.forEach((item) => {
    item.setAttribute('aria-selected', String(item === tab));
    item.tabIndex = item === tab ? 0 : -1;
  });
  const panel = document.getElementById('terminal-panel');
  const [command, output] = demos[tab.dataset.demo];
  panel.setAttribute('aria-labelledby', tab.id);
  document.getElementById('demo-description').textContent = tab.dataset.description;
  panel.querySelector('.terminal-command').innerHTML = `<span>❯</span> ${command}`;
  panel.querySelector('.terminal-output').innerHTML = output;
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (event) => {
    let target;
    if (event.key === 'ArrowRight') target = tabs[(index + 1) % tabs.length];
    if (event.key === 'ArrowLeft') target = tabs[(index + tabs.length - 1) % tabs.length];
    if (event.key === 'Home') target = tabs[0];
    if (event.key === 'End') target = tabs.at(-1);
    if (!target) return;
    event.preventDefault();
    selectTab(target);
    target.focus();
  });
});
const menu = document.querySelector('.docs-menu');
const sidebar = document.querySelector('.sidebar');
function closeMenu() {
  menu?.setAttribute('aria-expanded', 'false');
  sidebar?.classList.remove('is-open');
}
menu?.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  sidebar.classList.toggle('is-open', open);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') {
    closeMenu();
    menu.focus();
  }
});
sidebar?.addEventListener('click', (event) => {
  if (event.target.closest('a')) closeMenu();
});
const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
const motion = document.querySelector('.motion-toggle');
let paused = preference.matches;
function applyMotion() {
  document.documentElement.classList.toggle('no-motion', paused);
  document.dispatchEvent(new Event('fx:motionchange'));
  motion?.setAttribute('aria-pressed', String(paused));
  if (motion) {
    motion.disabled = preference.matches;
    motion.textContent = preference.matches
      ? labels.reduced || 'Reduced motion'
      : paused
        ? labels.resume || 'Resume motion'
        : labels.pause || 'Pause motion';
  }
}
motion?.addEventListener('click', () => {
  paused = !paused;
  applyMotion();
});
preference.addEventListener('change', (event) => {
  paused = event.matches;
  applyMotion();
});
applyMotion();
if ('IntersectionObserver' in window) {
  const links = [...document.querySelectorAll('.toc a')];
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.find((entry) => entry.isIntersecting);
      if (!visible) return;
      links.forEach((link) =>
        link.classList.toggle('active', link.hash === `#${visible.target.id}`),
      );
    },
    { rootMargin: '-100px 0px -65% 0px' },
  );
  document.querySelectorAll('.prose h2, .prose h3').forEach((heading) => observer.observe(heading));
}

// Native details links retain a usable language switch even without JavaScript.
const languageMenu = document.querySelector('.language-menu');
document.addEventListener('click', (event) => {
  if (languageMenu && !languageMenu.contains(event.target)) languageMenu.open = false;
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && languageMenu?.open) {
    languageMenu.open = false;
    languageMenu.querySelector('summary').focus();
  }
});
