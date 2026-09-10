// Prevent developer handovers or personal setup information from leaking into user docs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertUserSources, assertPublicContent, assertPublicPath } from '../audience.mjs';
import { pages } from '../pages.mjs';
test('the site accepts user guides and rejects maintainer source documents', () => {
  assertUserSources(pages);
  for (const source of [
    'README.md',
    'AGENTS.md',
    'CONTRIBUTING.md',
    'docs/public-release.md',
    'docs/delivery.md',
    'docs/validation.md',
    'docs/design/runtime.md',
    'docs/eval/README.md',
    'docs/website/README.md',
  ]) {
    assert.throws(() => assertUserSources([{ source }]), /Not a user/);
  }
});
test('public content cannot link retired maintainer routes or expose personal/build state', () => {
  for (const text of [
    '<a href="https://angelmsger.github.io/fx-devkit/docs/public-release/">Release</a>',
    '<a href="/fx-devkit/ja/docs/website/">Setup</a>',
    'build-manifest.json',
    'npm run site:build',
    'scripts/publish.mjs',
    '/Users/example/Development/',
    'appgprj_example123',
  ]) {
    assert.throws(() => assertPublicContent(text, 'fixture'), /Maintainer material/);
  }
});
test('user release checks and ordinary fx settings remain documented', () => {
  assert.doesNotThrow(() =>
    assertPublicContent(
      'Run fx release --format json to check your repositories. Use FX_HOME to relocate ~/.fx.',
      'user-guide',
    ),
  );
});

test('retired routes and private metadata cannot remain in deployable files', () => {
  for (const file of [
    'docs/public-release/index.html',
    'ja/docs/design/index.html',
    'zh-Hans/docs/website/index.html',
    'build-manifest.json',
    '.openai/hosting.json',
  ])
    assert.throws(() => assertPublicPath(file), /Non-user file/);
  assert.doesNotThrow(() => assertPublicPath('zh-Hant/docs/support/index.html'));
});
