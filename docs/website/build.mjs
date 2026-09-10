// Builds static HTML from the canonical repository Markdown and shared site assets.
import { mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Marked, Renderer } from 'marked';
import { pages } from './pages.mjs';
import { assertUserSources, assertPublicContent } from './audience.mjs';
assertUserSources(pages);
import { distribution, packageChannel } from '../../src/domain/distribution.js';
import { distributionMarkdown } from './distribution.mjs';
import { publicTarget } from './public-links.mjs';
import { locales, messages, message, validateCatalogs } from './i18n.mjs';
import { basePath, siteOrigin, relativeHref as href, localizedRoute } from './paths.mjs';

const site = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(site, '../..');
const output = path.join(site, 'dist');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const { version } = pkg;
const channel = process.env.FX_DISTRIBUTION || packageChannel(pkg.name);
const selectedDistribution = distribution(channel);
// Recognize historic links locally; deployment coordinates are supplied by the host.
const homepage = 'https://angelmsger.github.io/fx-devkit/';
const legacyRepository = 'https://github.com/AngelMsger/fx-devkit';
const repository =
  process.env.SITE_REPOSITORY_URL || (channel === 'public' ? legacyRepository : '');
if (repository) {
  const target = new URL(repository);
  if (
    !['https:', 'http:'].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash
  )
    throw new Error(
      'SITE_REPOSITORY_URL must be an HTTP(S) URL without credentials, query or fragment.',
    );
}
const series = version.split('.').slice(0, 2).join('.');
export const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
const plain = (value) =>
  value
    .replace(/<[^>]*>/g, '')
    .replace(
      /&(?:amp|lt|gt|quot|#39);/g,
      (entity) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity],
    );
const slug = (value) =>
  plain(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]/gu, '')
    .replace(/\s/g, '-');
const base = basePath(process.env.SITE_BASE_PATH || '/');
const origin = siteOrigin(process.env.SITE_ORIGIN);
const catalogs = Object.fromEntries(
  await Promise.all(locales.map(async ({ id }) => [id, await messages(id)])),
);
const translationManifest = JSON.parse(
  await readFile(path.join(site, 'i18n/translations.json'), 'utf8'),
);
validateCatalogs(catalogs, pages);
if (channel === 'public') {
  for (const catalog of Object.values(catalogs)) {
    catalog.preRelease = catalog.publicRelease;
    catalog.installNote = catalog.publicInstallNote;
  }
}
const catalogHash = createHash('sha256')
  .update(await readFile(path.join(site, 'i18n/en.json')))
  .digest('hex');
for (const { id } of locales.filter((item) => item.id !== 'en')) {
  if (translationManifest[id]?._catalog_sha256 !== catalogHash)
    throw new Error(`UI translations need review: ${id}`);
}
const localizedSources = [];
const mediaAssets = new Set();
const routes = new Map(pages.map((page) => [page.source, page.route]));
function localLink(page, target) {
  const publicLink = publicTarget(target, { homepage, repository: legacyRepository });
  if (publicLink?.route !== undefined) {
    const selected = locales.find(({ id }) => id !== 'en' && publicLink.route.startsWith(`${id}/`));
    const route = selected ? publicLink.route.slice(selected.id.length + 1) : publicLink.route;
    if (route === '' || [...routes.values()].includes(route))
      return href(page.route, localizedRoute(selected?.id ?? page.locale, route) + publicLink.hash);
    throw new Error(`Link to unpublished site page: ${target}`);
  }
  if (publicLink?.source === 'LICENSE') return href(page.route, 'LICENSE.txt');
  if (publicLink?.source && routes.has(publicLink.source)) {
    return href(
      page.route,
      localizedRoute(page.locale, routes.get(publicLink.source)) + publicLink.hash,
    );
  }
  if (publicLink?.source) throw new Error(`Link to non-user repository document: ${target}`);
  if (/^(https?:|mailto:)/i.test(target) || target.startsWith('#')) return target;
  if (/^[a-z]+:/i.test(target) || target.startsWith('//'))
    throw new Error(`Unsupported link in ${page.source}`);
  const [file, hash] = target.split('#');
  const source = path.posix.normalize(path.posix.join(path.posix.dirname(page.source), file));
  if (source === 'LICENSE') return href(page.route, 'LICENSE.txt');
  const route = routes.get(source);
  if (!route) throw new Error(`Add a public route for ${source} (linked from ${page.source})`);
  return href(page.route, `${localizedRoute(page.locale, route)}${hash ? `#${hash}` : ''}`);
}
function frame({
  route = '',
  canonicalRoute = '',
  locale = 'en',
  title,
  description,
  body,
  docs = false,
  rootLinks = false,
}) {
  const catalog = catalogs[locale];
  const t = (key) => escapeHtml(message(catalog, key));
  const asset = (target) => (rootLinks ? `${base}${target}` : href(route, target));
  const url = (target) => asset(localizedRoute(locale, target));
  const alternate = (lang) =>
    rootLinks
      ? `${base}${localizedRoute(lang, canonicalRoute)}`
      : href(route, localizedRoute(lang, canonicalRoute));
  const runtime = Object.fromEntries(
    ['copied', 'copyFallback', 'pause', 'resume', 'reduced'].map((key) => [key, catalog[key]]),
  );
  const languageMenu = `<details class="language-menu"><summary aria-label="${t('language')}">${locales.find((item) => item.id === locale).name}<span aria-hidden="true">⌄</span></summary><nav aria-label="${t('language')}">${locales.map(({ id, name, tag }) => `<a href="${alternate(id)}" lang="${tag}" hreflang="${tag}"${id === locale ? ' aria-current="true"' : ''}>${name}</a>`).join('')}</nav></details>`;
  const seo = origin
    ? `<link rel="canonical" href="${escapeHtml(origin + base + route)}">${locales.map(({ id, tag }) => `<link rel="alternate" hreflang="${tag}" href="${escapeHtml(origin + base + localizedRoute(id, canonicalRoute))}">`).join('')}<link rel="alternate" hreflang="x-default" href="${escapeHtml(origin + base + canonicalRoute)}">`
    : '';
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${escapeHtml(description)}">${channel === 'internal' ? '<meta name="robots" content="noindex, nofollow">' : ''}<meta name="theme-color" content="#101211"><title>${escapeHtml(title)} — fx-devkit</title>${seo}<link rel="icon" href="${asset('assets/favicon.svg')}" type="image/svg+xml"><link rel="stylesheet" href="${asset('assets/site.css')}"><script src="${asset('assets/site.js')}" defer></script><noscript><style>@media(max-width:620px){.sidebar{display:block;position:static;height:auto;border:0}.docs-menu{display:none}}</style></noscript></head>
<body class="${docs ? 'docs-page' : 'home-page'}" data-messages="${escapeHtml(JSON.stringify(runtime))}"><a href="#main" class="skip">${t('skip')}</a><header class="site-header"><nav class="nav shell" aria-label="${t('mainNav')}"><a href="${url('')}" class="brand" aria-label="${t('home')}"><span class="brand-symbol" aria-hidden="true">f<i>x</i>_</span> fx-devkit <small>${escapeHtml(series)}</small></a><div class="nav-links"><a class="nav-optional" href="${url('')}#capabilities">${t('why')}</a><a href="${url('docs/')}"${docs ? ' aria-current="page"' : ''}>${t('docs')}</a><a class="nav-optional" href="${url('docs/changelog/')}">${t('changelog')}</a>${languageMenu}<a class="nav-cta" href="${url('docs/getting-started/')}">${t('getStarted')} <span aria-hidden="true">↗</span></a></div></nav></header>${body}
<footer class="footer"><div class="shell footer-inner"><span>fx-devkit / ${t('footer')}</span><div class="footer-links">${repository ? `<a href="${escapeHtml(repository)}">Source ↗</a>` : ''}<a href="${asset('LICENSE.txt')}">Apache-2.0</a><a href="${url('docs/getting-started/#concepts')}">${t('architecture')}</a><a href="${url('docs/support/')}">${t('releaseStatus')}</a><button class="motion-toggle" aria-pressed="false">${t('pause')}</button></div></div></footer><div class="copy-status" role="status" aria-live="polite"></div></body></html>`;
}
function sidebar(page) {
  const groups = [...new Set(pages.map((entry) => entry.group))];
  return `<nav class="sidebar" id="docs-sidebar" aria-label="Documentation">${groups
    .map(
      (group) =>
        `<div class="sidebar-group"><h2>${escapeHtml(catalogs[page.locale].groups[group])}</h2>${pages
          .filter((entry) => entry.group === group)
          .map(
            (entry) =>
              `<a href="${href(page.route, localizedRoute(page.locale, entry.route))}"${entry.route === page.canonicalRoute ? ' aria-current="page"' : ''}>${escapeHtml(catalogs[page.locale].pages[entry.route].title)}</a>`,
          )
          .join('')}</div>`,
    )
    .join('')}</nav>`;
}
function markdown(page, source) {
  const headings = [];
  const counts = new Map();
  let firstHeading = true;
  const standard = new Renderer();
  const parser = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const rendered = this.parser.parseInline(tokens);
        const explicit = /\s*\{#([a-z0-9_-]+)\}$/.exec(rendered);
        const text = explicit ? rendered.slice(0, explicit.index) : rendered;
        const base = explicit?.[1] ?? slug(text);
        const count = counts.get(base) ?? 0;
        counts.set(base, count + 1);
        const id = `${base}${count ? `-${count}` : ''}`;
        if (firstHeading && depth === 1) {
          firstHeading = false;
          return `<span id="${escapeHtml(id)}"></span>`;
        }
        if (depth === 2 || depth === 3) headings.push({ id, depth, text: plain(text) });
        return `<h${depth} id="${escapeHtml(id)}">${text}</h${depth}>`;
      },
      link({ href: target, title, tokens }) {
        return `<a href="${escapeHtml(localLink(page, target))}"${title ? ` title="${escapeHtml(title)}"` : ''}>${this.parser.parseInline(tokens)}</a>`;
      },
      image({ href: target, title, text }) {
        let src = target;
        if (!/^https?:\/\//.test(target)) {
          const source = path.posix.normalize(
            path.posix.join(path.posix.dirname(page.source), target),
          );
          if (!source.startsWith('docs/assets/') || !/\.(?:png|jpe?g|webp|gif|svg)$/i.test(source))
            throw new Error(`Unsupported documentation image: ${target}`);
          mediaAssets.add(source);
          src = href(page.route, `assets/docs/${source.slice('docs/assets/'.length)}`);
        }
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ''} decoding="async">`;
      },
      code({ text, lang }) {
        return `<div class="code-block"><div class="code-top"><span>${escapeHtml(lang || 'text')}</span><button class="copy" data-code-copy aria-label="${escapeHtml(catalogs[page.locale].copyCode)}">${escapeHtml(catalogs[page.locale].copy)}</button></div><pre><code>${escapeHtml(text)}</code></pre></div>`;
      },
      table(token) {
        standard.parser = this.parser;
        return `<div class="table-scroll" tabindex="0" role="region" aria-label="${escapeHtml(catalogs[page.locale].table)}">${standard.table(token)}</div>`;
      },
      html({ text }) {
        return text.startsWith('<!--') ? '' : escapeHtml(text);
      },
    },
  });
  const html = parser.parse(source.replace(/^---\n[\s\S]*?\n---\n/, ''));
  return { html, headings };
}
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'assets'), { recursive: true });
await cp(path.join(root, 'LICENSE'), path.join(output, 'LICENSE.txt'));
await cp(path.join(site, 'src/site.css'), path.join(output, 'assets/site.css'));
await cp(path.join(site, 'src/site.js'), path.join(output, 'assets/site.js'));
await cp(path.join(site, 'src/probe.js'), path.join(output, 'assets/probe.js'));
await cp(path.join(site, 'src/favicon.svg'), path.join(output, 'assets/favicon.svg'));
const homeTemplate = await readFile(path.join(site, 'src/home.html'), 'utf8');
const routeRecords = [];
for (const { id: locale } of locales) {
  const catalog = catalogs[locale];
  const t = (key) => escapeHtml(message(catalog, key));
  const homeRoute = localizedRoute(locale);
  // Catalog HTML is author-controlled layout copy, not user or remote content.
  const home = homeTemplate
    .replace(/\{\{([A-Za-z]+)\}\}/g, (_, key) =>
      key === 'version'
        ? escapeHtml(version)
        : key === 'packageName'
          ? selectedDistribution.packageName
          : message(catalog, key),
    )
    .replace('src="./assets/probe.js"', `src="${href(homeRoute, 'assets/probe.js')}"`);
  await mkdir(path.join(output, homeRoute), { recursive: true });
  await writeFile(
    path.join(output, homeRoute, 'index.html'),
    frame({
      route: homeRoute,
      locale,
      title: catalog.siteTitle,
      description: catalog.siteDescription,
      body: home,
    }),
  );
  routeRecords.push(homeRoute);
  for (const [index, canonical] of pages.entries()) {
    const page = {
      ...canonical,
      canonicalRoute: canonical.route,
      route: localizedRoute(locale, canonical.route),
      locale,
      ...catalog.pages[canonical.route],
    };
    let source = await readFile(path.join(root, page.source), 'utf8');
    let fallback = locale !== 'en';
    const translation = translationManifest[locale]?.[page.source];
    if (translation) {
      const digest = createHash('sha256').update(source).digest('hex');
      if (digest !== translation.source_sha256)
        throw new Error(`Translation needs review: ${locale} / ${page.source}`);
      const translatedPath = `docs/website/i18n/${locale}/${translation.file}`;
      localizedSources.push(translatedPath);
      source = await readFile(path.join(root, translatedPath), 'utf8');
      fallback = false;
    }
    if (locale !== 'en' && page.source === 'docs/README.md') {
      source =
        `# ${catalog.docs}\n\n${catalog.siteDescription}\n\n` +
        pages
          .filter((entry) => entry.source !== 'docs/README.md')
          .map(
            (entry) =>
              `- [${catalog.pages[entry.route].title}](${path.posix.relative('docs', entry.source)}): ${catalog.pages[entry.route].description}`,
          )
          .join('\n');
      fallback = false;
    }
    const { html, headings } = markdown(page, distributionMarkdown(source, channel));
    assertPublicContent(html, page.route);
    const adjacent = (entry, next) =>
      entry
        ? `<a href="${href(page.route, localizedRoute(locale, entry.route))}" class="${next ? 'next' : 'previous'}"><span>${next ? t('next') : t('previous')}</span>${escapeHtml(catalog.pages[entry.route].title)}</a>`
        : '<div></div>';
    const notice = fallback
      ? `<aside class="translation-note"><strong>${t('englishReference')}</strong><p>${t('fallback')}</p><a href="${href(page.route, canonical.route)}" lang="en">${t('original')}</a></aside>`
      : '';
    const body = `<button class="docs-menu" aria-expanded="false" aria-controls="docs-sidebar">${t('docMenu')} <span aria-hidden="true">+</span></button><div class="docs-layout">${sidebar(page)}<main id="main" class="doc-body"><div class="breadcrumb"><a href="${href(page.route, localizedRoute(locale, 'docs/'))}">${t('docs')}</a><span>/</span><span>${escapeHtml(catalog.groups[page.group])}</span></div><div class="doc-kicker">${t('docKicker')}</div><h1 class="doc-title">${escapeHtml(page.title)}</h1><p class="doc-description">${escapeHtml(page.description)}</p><div class="doc-meta"><span>v${escapeHtml(version)} · ${t('preRelease')}</span></div>${notice}<article class="prose" lang="${fallback ? 'en' : locale}">${html}</article><nav class="doc-pagination" aria-label="${t('docs')}">${adjacent(pages[index - 1], false)}${adjacent(pages[index + 1], true)}</nav></main><nav class="toc" aria-label="${t('onPage')}"><h2>${t('onPage')}</h2>${headings.map((heading) => `<a class="depth-${heading.depth}" href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a>`).join('')}<a href="#main">${t('top')}</a></nav></div>`;
    await mkdir(path.join(output, page.route), { recursive: true });
    await writeFile(
      path.join(output, page.route, 'index.html'),
      frame({ ...page, body, docs: true }),
    );
    routeRecords.push(page.route);
  }
}
await writeFile(
  path.join(output, '404.html'),
  frame({
    title: catalogs.en.notFound,
    rootLinks: true,
    description: catalogs.en.notFoundBody,
    body: `<main id="main" class="shell closing"><div><span class="eyebrow">ERROR / 404</span><h1>${catalogs.en.notFoundTitle}</h1><p class="muted">${catalogs.en.notFoundBody}</p><a class="button primary" href="${base}docs/">${catalogs.en.readDocs} ↗</a></div></main>`,
  }),
);
await writeFile(path.join(output, '.nojekyll'), '');
if (origin) {
  await writeFile(
    path.join(output, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routeRecords.map((route) => `<url><loc>${escapeHtml(origin + base + route)}</loc></url>`).join('')}</urlset>`,
  );
  await writeFile(
    path.join(output, 'robots.txt'),
    `User-agent: *\n${channel === 'internal' ? 'Disallow' : 'Allow'}: /\nSitemap: ${origin}${base}sitemap.xml\n`,
  );
}
for (const source of mediaAssets) {
  const destination = path.join(output, 'assets/docs', source.slice('docs/assets/'.length));
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(path.join(root, source), destination);
}
const sourceFiles = [
  ...new Set([
    'package.json',
    'LICENSE',
    ...mediaAssets,
    'docs/website/public-links.mjs',
    'docs/website/distribution.mjs',
    'src/domain/distribution.js',
    'docs/website/audience.mjs',
    'docs/website/package.json',
    'docs/website/package-lock.json',
    'docs/website/build.mjs',
    'docs/website/check.mjs',
    'docs/website/pages.mjs',
    'docs/website/paths.mjs',
    'docs/website/i18n.mjs',
    'docs/website/i18n/translations.json',
    ...locales.map(({ id }) => `docs/website/i18n/${id}.json`),
    ...localizedSources,
    'docs/website/src/home.html',
    'docs/website/src/site.css',
    'docs/website/src/site.js',
    'docs/website/src/probe.js',
    'docs/website/src/favicon.svg',
    ...pages.map((page) => page.source),
  ]),
];
const sources = Object.fromEntries(
  await Promise.all(
    sourceFiles.map(async (file) => [
      file,
      createHash('sha256')
        .update(await readFile(path.join(root, file)))
        .digest('hex'),
    ]),
  ),
);
await writeFile(
  path.join(site, '.build-state.json'),
  JSON.stringify({ sources, base, origin, repository, channel, routes: routeRecords }, null, 2) +
    '\n',
);
console.log(
  `Built ${locales.length} locales, ${routeRecords.length} routes, and 404 into docs/website/dist (base: ${base}).`,
);
