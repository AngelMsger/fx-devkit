import { describe, expect, it } from 'vitest';

import { verifyContributionRemote } from '../../../../src/domain/contribution/remote.js';

const upstream = {
  ref: { project: 'TEAM', name: 'manifest' },
  cloneUrls: ['ssh://git@git.example.com/TEAM/manifest.git'],
  defaultBranch: 'main',
  personalOwner: null,
  parent: null,
};
const origin = {
  ref: { project: '~alice', name: 'manifest' },
  cloneUrls: ['ssh://git@git.example.com/~alice/manifest.git'],
  defaultBranch: 'main',
  personalOwner: 'alice',
  parent: upstream.ref,
};
const settings = {
  originUrls: origin.cloneUrls,
  pushUrls: origin.cloneUrls,
  upstreamUrls: upstream.cloneUrls,
  hasRewrite: false,
  isMirror: false,
  receivePack: null,
  fingerprint: 'settings',
};
const input = { settings, origin, upstream, user: 'alice', branch: 'fx/contribution/test' };

describe('contribution remote verification', () => {
  it('matches Windows local paths and file URLs while retaining fork identity checks', () => {
    const fork = 'C:\\Work Space\\alice\\manifest.git';
    const base = 'D:\\hosts\\team\\manifest.git';
    const result = verifyContributionRemote({
      ...input,
      settings: { ...settings, originUrls: [fork], pushUrls: [fork], upstreamUrls: [base] },
      origin: { ...origin, cloneUrls: ['file:///c:/Work%20Space/alice/manifest.git'] },
      upstream: { ...upstream, cloneUrls: ['file:///d:/hosts/team/manifest.git'] },
    });
    expect(result.url).toBe(fork);
    expect(result.source).toEqual(origin.ref);
  });
  it('accepts only the current user fork whose parent is the verified upstream', () => {
    expect(verifyContributionRemote(input)).toMatchObject({
      url: origin.cloneUrls[0],
      fingerprint: 'settings',
      source: origin.ref,
      target: upstream.ref,
    });
  });
  it.each([
    { origin: { ...origin, personalOwner: 'bob' } },
    { origin: { ...origin, parent: { project: 'OTHER', name: 'manifest' } } },
    { origin: { ...origin, ref: upstream.ref } },
    {
      settings: { ...settings, pushUrls: ['ssh://git@elsewhere.example.com/~alice/manifest.git'] },
    },
  ])('rejects an unverified owner, parent or transport identity', (patch) => {
    expect(() => verifyContributionRemote({ ...input, ...patch })).toThrow(
      expect.objectContaining({ code: 'SOURCE_REMOTE_UNSAFE' }),
    );
  });
  it('treats missing companion identity evidence as a handoff, not a verified fork', () => {
    expect(() =>
      verifyContributionRemote({ ...input, origin: { ...origin, parent: undefined } }),
    ).toThrow(expect.objectContaining({ code: 'SOURCE_IDENTITY_UNVERIFIED' }));
  });
  it.each([
    { pushUrls: [...origin.cloneUrls, ...upstream.cloneUrls] },
    { originUrls: [...origin.cloneUrls, ...upstream.cloneUrls] },
    { hasRewrite: true },
    { isMirror: true },
    { receivePack: 'custom-command' },
  ])('rejects ambiguous or overridden Git routing', (patch) => {
    expect(() =>
      verifyContributionRemote({ ...input, settings: { ...settings, ...patch } }),
    ).toThrow(expect.objectContaining({ code: 'SOURCE_REMOTE_UNSAFE' }));
  });
  it('refuses a default branch or a non-managed branch', () => {
    expect(() => verifyContributionRemote({ ...input, branch: 'main' })).toThrow(
      expect.objectContaining({ code: 'SOURCE_BRANCH_INVALID' }),
    );
    expect(() => verifyContributionRemote({ ...input, branch: 'other' })).toThrow(
      expect.objectContaining({ code: 'SOURCE_BRANCH_INVALID' }),
    );
  });
  it('normalizes an SCP spelling only when it matches a provider-advertised URL', () => {
    expect(
      verifyContributionRemote({
        ...input,
        settings: { ...settings, pushUrls: ['git@git.example.com:~alice/manifest.git'] },
      }).source,
    ).toEqual(origin.ref);
  });
  it('rejects embedded credentials without echoing them', () => {
    const unsafe = 'https://alice:secret-value@git.example.com/~alice/manifest.git';
    try {
      verifyContributionRemote({
        ...input,
        settings: { ...settings, pushUrls: [unsafe] },
        origin: { ...origin, cloneUrls: [unsafe] },
      });
    } catch (error) {
      expect(error).toMatchObject({ code: 'SOURCE_REMOTE_UNSAFE' });
      expect(String(error)).not.toContain('secret-value');
      return;
    }
    expect.fail('unsafe URL was accepted');
  });
});
