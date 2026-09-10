// Exercises the built fx adapter through an actual companion binary and a
// loopback-only fixture server. No account, installed configuration or real PR is used.

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BitbucketCodeHost } from '../../dist/adapters/code-host/bitbucket-cli/provider.js';
import { NodeFs } from '../../dist/adapters/fs/node-fs.js';
import { NodeProcess } from '../../dist/adapters/process/node-process.js';
import { verifyContributionRemote } from '../../dist/domain/contribution/remote.js';

const binary = process.argv[2];
assert(binary && path.isAbsolute(binary), 'Pass an absolute companion binary path.');
const directory = await fs.mkdtemp(path.join(tmpdir(), 'fx-companion-contract-'));
const description = 'first line\nsecond line with literal \\n';
const branch = 'fx/contribution/smoke';
let posts = 0;
let requestMatches = false;
let phase = 'repository-query';
const server = http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  response.setHeader('Content-Type', 'application/json');
  if (request.method === 'GET' && pathname.endsWith('/branches'))
    return response.end(
      JSON.stringify({
        values: [
          {
            displayId: 'main',
            id: 'refs/heads/main',
            latestCommit: 'a'.repeat(40),
            isDefault: true,
          },
        ],
        isLastPage: true,
        size: 1,
        start: 0,
      }),
    );
  if (request.method === 'GET' && pathname.endsWith('/pull-requests/12'))
    return response.end(JSON.stringify(pullRequest()));
  if (request.method === 'POST' && pathname.endsWith('/pull-requests')) {
    let text = '';
    for await (const chunk of request) text += chunk;
    const body = JSON.parse(text);
    posts++;
    requestMatches =
      body.description === description &&
      body.fromRef.id === `refs/heads/${branch}` &&
      body.fromRef.repository.project.key === '~alice' &&
      body.toRef.id === 'refs/heads/main' &&
      body.toRef.repository.project.key === 'TEAM';
    return response.end(JSON.stringify(pullRequest()));
  }
  const matched = /\/projects\/([^/]+)\/repos\/manifest$/.exec(pathname);
  if (request.method === 'GET' && matched)
    return response.end(JSON.stringify(repository(matched[1])));
  response.statusCode = 404;
  response.end('{}');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const endpoint = `http://127.0.0.1:${server.address().port}`;
const inherited = Object.fromEntries(
  Object.keys(process.env)
    .filter((key) => key.startsWith('BITBUCKET_'))
    .map((key) => [key, undefined]),
);
const native = new NodeProcess();
const runner = {
  which: async () => binary,
  run: (vector, options = {}) =>
    native.run(
      [
        binary,
        '--config',
        directory,
        '--base-url',
        endpoint,
        '--flavor',
        'datacenter',
        ...vector.slice(1),
      ],
      {
        ...options,
        cwd: directory,
        env: {
          ...inherited,
          BITBUCKET_PERSONAL_ACCESS_TOKEN: 'local-fixture-token',
          BITBUCKET_CLI_SKILL: '1',
          BITBUCKET_CLI_NO_UPDATE_NOTIFIER: '1',
          BITBUCKET_CLI_READ_ONLY: '1',
          BITBUCKET_RELEASE_API: `${endpoint}/releases/latest`,
        },
      },
    ),
};
try {
  const host = new BitbucketCodeHost(
    { process: runner, fs: new NodeFs(), clock: { now: () => new Date() } },
    { host: 'ssh://git@git.example.com', web: 'https://git.example.com' },
  );
  const origin = await host.repositoryIdentity({ project: '~alice', name: 'manifest' });
  const upstream = await host.repositoryIdentity({ project: 'TEAM', name: 'manifest' });
  phase = 'parent-evidence';
  assert.deepEqual(origin.parent, upstream.ref);
  assert.equal(upstream.parent, null);
  verifyContributionRemote({
    origin,
    upstream,
    user: 'alice',
    branch,
    settings: {
      originUrls: origin.cloneUrls,
      pushUrls: origin.cloneUrls,
      upstreamUrls: upstream.cloneUrls,
      hasRewrite: false,
      isMirror: false,
      receivePack: null,
      fingerprint: 'fixture',
    },
  });
  phase = 'pull-request-roundtrip';
  const input = {
    source: { repo: origin.ref, branch },
    target: { repo: upstream.ref, branch: 'main' },
    title: 'Fixture contribution',
    description,
    allowWrites: false,
  };
  await assert.rejects(host.createPullRequest(input), { category: 'permission' });
  assert.equal(posts, 0);
  const created = await host.createPullRequest({ ...input, allowWrites: true });
  assert.equal(created.id, '12');
  assert.equal(requestMatches, true);
  assert.equal(posts, 1);
  assert.deepEqual(await host.pullRequest({ repo: upstream.ref, id: created.id }), created);
  console.log(
    JSON.stringify({
      ok: true,
      parent_evidence: true,
      read_only_preserved: true,
      exact_description: true,
      local_posts: posts,
    }),
  );
} catch (error) {
  console.error(JSON.stringify({ ok: false, phase, code: error.code ?? 'SMOKE_FAILED' }));
  process.exitCode = 1;
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
}

function repository(project) {
  const value = {
    slug: 'manifest',
    name: 'manifest',
    project: { key: project },
    links: { clone: [{ name: 'ssh', href: `ssh://git@git.example.com/${project}/manifest.git` }] },
  };
  if (project === '~alice') value.origin = repository('TEAM');
  return value;
}

function pullRequest() {
  return {
    id: 12,
    title: 'Fixture contribution',
    description,
    state: 'OPEN',
    fromRef: { id: `refs/heads/${branch}`, displayId: branch, repository: repository('~alice') },
    toRef: { id: 'refs/heads/main', displayId: 'main', repository: repository('TEAM') },
    links: {
      self: [{ href: 'https://git.example.com/projects/TEAM/repos/manifest/pull-requests/12' }],
    },
  };
}
