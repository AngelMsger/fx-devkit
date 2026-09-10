// npm readers use public URLs; the generated website keeps its own links local.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicTarget } from '../public-links.mjs';
const project = {
  homepage: 'https://angelmsger.github.io/fx-devkit/',
  repository: 'https://github.com/AngelMsger/fx-devkit',
};
test('resolves documentation sections and shipped license from inferred public coordinates', () => {
  assert.deepEqual(publicTarget(project.homepage + 'docs/getting-started/#install', project), {
    route: 'docs/getting-started/',
    hash: '#install',
  });
  assert.deepEqual(publicTarget(project.repository + '/blob/main/LICENSE', project), {
    source: 'LICENSE',
    hash: '',
  });
  assert.deepEqual(publicTarget(project.repository + '/blob/main/AGENTS.md', project), {
    source: 'AGENTS.md',
    hash: '',
  });
});
test('preserves other projects, branches, external pages and query-bearing URLs', () => {
  for (const url of [
    'https://angelmsger.github.io/bitbucket-cli/',
    project.repository + '/blob/dev/AGENTS.md',
    project.repository + '/issues',
    project.homepage + '?preview=1',
    '../LICENSE',
  ])
    assert.equal(publicTarget(url, project), null);
});
