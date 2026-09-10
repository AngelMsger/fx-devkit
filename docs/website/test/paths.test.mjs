// Deployment prefixes must not leak root-only assets or credentials into static URLs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basePath, siteOrigin, localizedRoute, relativeHref } from '../paths.mjs';
import { locales, messages, validateCatalogs } from '../i18n.mjs';
import { pages } from '../pages.mjs';

test('origin-root and project-subpath navigation resolve identically', () => {
  for (const base of ['/', '/fx-devkit/', '/team/docs/']) {
    const from = localizedRoute('ja', 'docs/getting-started/');
    const current = new URL(base + from, 'https://example.github.io');
    assert.equal(
      new URL(relativeHref(from, 'assets/site.css'), current).pathname,
      base + 'assets/site.css',
    );
    assert.equal(
      new URL(relativeHref(from, localizedRoute('zh-Hant', 'docs/getting-started/')), current)
        .pathname,
      base + 'zh-Hant/docs/getting-started/',
    );
    assert.equal(basePath(base), base);
  }
});
test('rejects ambiguous base paths and credential-bearing or non-origin metadata', () => {
  for (const value of ['fx-devkit', '/fx-devkit', '//', '/../', '/x/../', '/x?token/'])
    assert.throws(() => basePath(value));
  for (const value of [
    'https://example.com/path',
    'https://user:secret@example.com',
    'https://example.com?x=1',
    'https://example.com#x',
    'file:///tmp',
  ])
    assert.throws(() => siteOrigin(value));
  assert.equal(siteOrigin('https://example.com'), 'https://example.com');
  assert.equal(siteOrigin(), '');
});
test('all locale catalogs are complete and missing translations fail explicitly', async () => {
  const catalogs = Object.fromEntries(
    await Promise.all(locales.map(async ({ id }) => [id, await messages(id)])),
  );
  validateCatalogs(catalogs, pages);
  const missing = structuredClone(catalogs);
  delete missing.ja.copy;
  assert.throws(() => validateCatalogs(missing, pages), /keys differ/);
  const stale = structuredClone(catalogs);
  stale.en.pages['docs/'].title = 'Old title';
  assert.throws(() => validateCatalogs(stale, pages), /metadata is stale/);
});
