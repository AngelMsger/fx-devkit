import { describe, expect, it } from 'vitest';

import { foldDefaults } from '../../../../src/domain/import/fold.js';
import { parseGitmodules } from '../../../../src/domain/import/gitmodules.js';
import {
  hostOf,
  inferBranch,
  inferRepo,
  inferUpstream,
  isPersonal,
  type RepoObservation,
} from '../../../../src/domain/import/infer.js';
import { renderManifest } from '../../../../src/domain/import/render.js';
import { loadWorkspace } from '../../../../src/domain/manifest/loader.js';
import { refFromUrl } from '../../../../src/domain/workspace/ref.js';

const HOST = 'ssh://git@git.example.com:12345';
const obs = (over: Partial<RepoObservation>): RepoObservation => ({
  rel: 'a',
  name: 'a',
  remotes: {},
  branch: 'dev',
  remoteHeads: {},
  gitmodulesBranch: undefined,
  ...over,
});

describe('parseGitmodules', () => {
  it('reads path, url and branch per submodule', () => {
    const text =
      '[submodule "x"]\n\tpath = x\n\turl = ssh://h/p/x.git\n\tbranch = dev\n\tignore = all\n[submodule "d/y"]\n\tpath = d/y\n\turl = ssh://h/p/y.git\n';
    expect(parseGitmodules(text)).toEqual({
      x: { url: 'ssh://h/p/x.git', branch: 'dev' },
      'd/y': { url: 'ssh://h/p/y.git' },
    });
    expect(parseGitmodules('')).toEqual({});
  });
});

describe('file URL coordinates', () => {
  it.each([
    ['file:///host/team%20space/api%20source.git', 'team space', 'api source'],
    ['file:///host/team%2520space/api%2525.git', 'team%20space', 'api%25'],
    ['/host/team%20space/api%25.git', 'team%20space', 'api%25'],
  ])('decodes only actual file URL paths: %s', (url, project, name) => {
    expect(refFromUrl(url)).toEqual({ project, name });
  });
  it('retains the encoded host separately from decoded file coordinates', () => {
    expect(hostOf('file:///host%20root/team%20space/api%25.git')).toBe('file:///host%20root');
    expect(refFromUrl('file:///host/team%2Fspace/api.git')).toBeUndefined();
  });
});

describe('upstream ladder', () => {
  it('takes upstream, then a non-personal origin, then a same-name search, else nothing', () => {
    expect(isPersonal(`${HOST}/~alice/a.git`)).toBe(true);
    expect(isPersonal(`${HOST}/fx/a.git`)).toBe(false);
    expect(hostOf(`${HOST}/fx/a.git`)).toBe(HOST);
    const seen = ['fx', 'ai'];
    expect(
      inferUpstream(
        obs({ remotes: { upstream: `${HOST}/fx/a.git`, origin: `${HOST}/~alice/a.git` } }),
        seen,
        () => true,
      ),
    ).toEqual({ url: `${HOST}/fx/a.git`, rung: 1 });
    expect(
      inferUpstream(obs({ remotes: { origin: `${HOST}/fx/a.git` } }), seen, () => true),
    ).toEqual({ url: `${HOST}/fx/a.git`, rung: 2 });
    expect(
      inferUpstream(obs({ remotes: { origin: `${HOST}/~alice/a.git` } }), seen, (p) => p === 'ai'),
    ).toEqual({ url: `${HOST}/ai/a.git`, rung: 3 });
    expect(
      inferUpstream(obs({ remotes: { origin: `${HOST}/~alice/a.git` } }), seen, () => false),
    ).toBeUndefined();
    expect(inferUpstream(obs({}), seen, () => true)).toBeUndefined();
  });
});

describe('unresolved provider output', () => {
  it('preserves Git URLs without enabling an invented API provider', () => {
    const remote = 'git@git.example.com:team/a.git';
    const inferred = inferRepo(
      obs({ remotes: { origin: remote }, remoteHeads: { origin: 'main' } }),
      [],
      () => false,
    );
    expect('repo' in inferred).toBe(true);
    if (!('repo' in inferred)) throw new Error('expected import candidate');
    const manifest = loadWorkspace(renderManifest(foldDefaults([inferred.repo])), {
      cliVersion: '1.0.0',
    }).doc;
    expect(manifest.providers).toEqual({});
    expect(manifest.defaults).not.toHaveProperty('host');
    expect(manifest.repos[0]?.upstream).toBe(remote);
  });

  it('omits a global binding for repositories with different verified hosts', () => {
    const inferred = inferRepo(obs({ remotes: { origin: '/host/team/a.git' } }), [], () => false);
    if (!('repo' in inferred)) throw new Error('expected import candidate');
    const a = { ...inferred.repo, provider: { provider: 'local-git', host: '/host' } };
    const b = {
      ...a,
      name: 'b',
      upstream: '/other/team/b.git',
      provider: { provider: 'local-git', host: '/other' },
    };
    const folded = foldDefaults([a, b]);
    expect(folded.provider).toBeUndefined();
    expect(folded.defaults.host).toBeUndefined();
    expect(folded.repos.every((repo) => repo.upstream !== undefined)).toBe(true);
  });
});

describe('branch ladder', () => {
  it('prefers .gitmodules, then the remote HEAD, then the checkout', () => {
    expect(
      inferBranch(
        obs({
          gitmodulesBranch: 'integration',
          remoteHeads: { upstream: 'master' },
          branch: 'feature/x',
        }),
        'upstream',
      ),
    ).toEqual({ name: 'integration', rung: 1 });
    expect(
      inferBranch(obs({ remoteHeads: { upstream: 'master' }, branch: 'feature/x' }), 'upstream'),
    ).toEqual({ name: 'master', rung: 2 });
    expect(inferBranch(obs({ branch: 'feature/x' }), 'upstream')).toEqual({
      name: 'feature/x',
      rung: 3,
    });
    expect(inferBranch(obs({ branch: undefined }), 'origin')).toBeUndefined();
  });

  it('leaves a review note for every rung below the first', () => {
    const r = inferRepo(
      obs({ remotes: { origin: `${HOST}/~alice/a.git` }, branch: 'feature/x' }),
      ['fx'],
      () => true,
    );
    expect('repo' in r && r.repo.review).toEqual([
      'upstream inferred by searching for a repository of this name; nothing in the checkout named the project.',
      'branch taken from the current checkout, which may be a task branch.',
    ]);
    expect(inferRepo(obs({}), [], () => false)).toEqual({
      skipped: 'no remote; a manifest describes remotes',
    });
  });
});

describe('foldDefaults and renderManifest', () => {
  it('folds the common values into defaults, keeps only deviations, and renders a manifest fx can read back', () => {
    const repos = [
      inferRepo(
        obs({
          name: 'a',
          rel: 'a',
          remotes: { upstream: `${HOST}/fx/a.git`, origin: `${HOST}/~alice/a.git` },
          gitmodulesBranch: 'dev',
        }),
        [],
        () => false,
      ),
      inferRepo(
        obs({
          name: 'b',
          rel: 'b',
          remotes: { upstream: `${HOST}/fx/b.git` },
          gitmodulesBranch: 'dev',
        }),
        [],
        () => false,
      ),
      inferRepo(
        obs({
          name: 'c',
          rel: 'tools/c',
          remotes: { upstream: `${HOST}/ai/c.git` },
          remoteHeads: { upstream: 'main' },
        }),
        [],
        () => false,
      ),
      inferRepo(
        obs({
          name: 'app',
          rel: 'app',
          remotes: { upstream: `${HOST}/fx/jdy-app.git` },
          gitmodulesBranch: 'dev',
        }),
        [],
        () => false,
      ),
    ].flatMap((r) =>
      'repo' in r ? [{ ...r.repo, provider: { provider: 'bitbucket-cli', host: HOST } }] : [],
    );
    const folded = foldDefaults(repos);
    expect(folded.defaults).toEqual({
      host: HOST,
      upstream_project: 'fx',
      branch: 'dev',
      origin_pattern: '~{user}/{repo}',
    });
    expect(folded.projects).toEqual(['ai', 'fx']);
    expect(folded.repos.map(({ review: _review, ...r }) => r)).toEqual([
      { name: 'a' },
      { name: 'app', upstream: `${HOST}/fx/jdy-app.git` },
      { name: 'b' },
      { name: 'c', project: 'ai', branch: 'main', path: 'tools/c' },
    ]);
    const text = renderManifest(folded);
    const doc = loadWorkspace(text, { cliVersion: '1.0.0' }).doc;
    expect(doc.schema_version).toBe(2);
    expect(doc.providers?.['code-host']).toEqual({
      provider: 'bitbucket-cli',
      vars: { host: HOST },
    });
    expect(doc.repos.map((r) => r.name)).toEqual(['a', 'app', 'b', 'c']);
    expect(text).toContain('# Generated by `fx manifest import`');
    const withReview = renderManifest({
      ...folded,
      repos: [
        {
          name: 'z',
          review: ['branch taken from the current checkout, which may be a task branch.'],
        },
      ],
    });
    expect(withReview).toMatch(
      /# review: branch taken from the current checkout[^\n]*\n\s*- name: z/,
    );
  });
});
