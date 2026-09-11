// Verify deployable output, source freshness, internal links and asset references.
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assertPublicContent, assertPublicPath } from './audience.mjs';
import { distribution } from '../../src/domain/distribution.js';
const site = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(site, '../..');
const output = path.join(site, 'dist');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const manifest = JSON.parse(await readFile(path.join(site, '.build-state.json'), 'utf8'));
for (const [source, expected] of Object.entries(manifest.sources)) {
  if (hash(await readFile(path.join(root, source))) !== expected)
    throw new Error(`Stale website: ${source} changed. Run npm run site:build.`);
}
async function walk(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, item.name);
    result.push(...(item.isDirectory() ? await walk(target) : [target]));
  }
  return result;
}
const files = await walk(output);
const known = new Set(files.map((file) => path.relative(output, file).split(path.sep).join('/')));
for (const file of known) assertPublicPath(file);
const pages = new Map();
for (const file of files.filter((file) => file.endsWith('.html'))) {
  const text = await readFile(file, 'utf8');
  assertPublicContent(text, file);
  const expected = distribution(manifest.channel).packageName;
  for (const [, name] of text.matchAll(/npm(?:\.cmd)? (?:install|i) -g (@[^\s<]+)/g)) {
    if (['@fx/devkit', '@angelmsger/fx'].includes(name) && name !== expected)
      throw new Error(`Wrong distribution install command in ${file}`);
  }
  const ids = [...text.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate anchor in ${file}`);
  if (!text.includes('<title>') || !text.includes('name="description"') || !ids.includes('main'))
    throw new Error(`Missing page metadata or main landmark: ${file}`);
  if ((text.match(/<h1\b/g) ?? []).length !== 1)
    throw new Error(`Expected one page title: ${file}`);
  pages.set(path.relative(output, file).split(path.sep).join('/'), { text, ids: new Set(ids) });
}
for (const route of manifest.routes) {
  const page = pages.get(`${route}index.html`);
  if (!page) throw new Error(`Missing generated locale route: ${route}`);
  const locale = /^(ja|zh-Hans|zh-Hant)\//.exec(route)?.[1] ?? 'en';
  if (!page.text.includes(`<html lang="${locale}">`))
    throw new Error(`Incorrect page language: ${route}`);
  if (
    page.text.includes('class="translation-note"') &&
    !page.text.includes('<article class="prose" lang="en">')
  )
    throw new Error(`English reference is not language-tagged: ${route}`);
  const menu = /<details class="language-menu">([\s\S]*?)<\/details>/.exec(page.text)?.[1] ?? '';
  if ((menu.match(/hreflang=/g) ?? []).length !== 4)
    throw new Error(`Missing language switch destinations: ${route}`);
  if (route.includes('docs/') && /src="[^"]*\/probe\.js(?:[?"])/.test(page.text))
    throw new Error(`Pointer probe must remain homepage-only: ${route}`);
}
if (
  known.has('build-manifest.json') ||
  [...known].some((file) =>
    /(?:^|\/)(?:\.openai|\.build-state|AGENTS\.md|CONTRIBUTING\.md)/.test(file),
  )
)
  throw new Error('Private build state or maintainer sources were published');
let links = 0;
for (const [file, page] of pages) {
  const current = new URL(manifest.base + file, 'https://static.example.com/');
  for (const [, attribute, value] of page.text.matchAll(/\b(href|src)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|data:)/i.test(value)) continue;
    const url = new URL(value.replace(/&amp;/g, '&'), current);
    if (!url.pathname.startsWith(manifest.base))
      throw new Error(`Link escaped deployment base: ${file} -> ${value}`);
    const relative = decodeURIComponent(url.pathname).slice(manifest.base.length);
    const target = !relative || relative.endsWith('/') ? `${relative}index.html` : relative;
    if (!known.has(target)) throw new Error(`Broken ${attribute}: ${file} -> ${value}`);
    if (/^assets\/(?:site\.css|site\.js|probe\.js)$/.test(target)) {
      const expectedVersion = hash(await readFile(path.join(output, target))).slice(0, 16);
      if (url.searchParams.get('v') !== expectedVersion)
        throw new Error(`Stale asset version: ${file} -> ${value}`);
    }
    if (
      url.hash &&
      pages.has(target) &&
      !pages.get(target).ids.has(decodeURIComponent(url.hash.slice(1)))
    )
      throw new Error(`Broken anchor: ${file} -> ${value}`);
    links++;
  }
}
for (const script of [
  'build.mjs',
  'check.mjs',
  'serve.mjs',
  'src/site.js',
  'src/probe.js',
  'i18n.mjs',
  'paths.mjs',
  'public-links.mjs',
  'audience.mjs',
]) {
  const result = spawnSync(process.execPath, ['--check', path.join(site, script)], {
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr);
}
console.log(
  `Validated ${pages.size} HTML pages, ${links} internal links/assets, source freshness, and JavaScript syntax.`,
);
