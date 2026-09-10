// A contribution target needs provider identity evidence as well as a Git name.
// Unknown parentage cannot be promoted to a fork merely by matching its URL.

import path from 'node:path';

import { DevkitError } from '../errors.js';
import type { RepoRef } from '../workspace/ref.js';

export interface RepositoryIdentity {
  readonly ref: RepoRef;
  readonly cloneUrls: readonly string[];
  readonly defaultBranch: string;
  readonly personalOwner: string | null;
  // undefined means the companion did not expose parentage; null means no parent.
  readonly parent: RepoRef | null | undefined;
}

export interface ContributionRemoteSettings {
  readonly originUrls: readonly string[];
  readonly pushUrls: readonly string[];
  readonly upstreamUrls: readonly string[];
  readonly hasRewrite: boolean;
  readonly isMirror: boolean;
  readonly receivePack: string | null;
  readonly fingerprint: string;
}

interface RemoteVerification {
  readonly settings: ContributionRemoteSettings;
  readonly origin: RepositoryIdentity;
  readonly upstream: RepositoryIdentity;
  readonly user: string;
  readonly branch: string;
}

export interface VerifiedContributionRemote {
  readonly url: string;
  readonly fingerprint: string;
  readonly source: RepoRef;
  readonly target: RepoRef;
  readonly targetBranch: string;
}

export function verifyContributionRemote(input: RemoteVerification): VerifiedContributionRemote {
  const { settings, origin, upstream } = input;
  if (
    !/^fx\/contribution\/[a-zA-Z0-9_-]+$/.test(input.branch) ||
    input.branch === origin.defaultBranch ||
    input.branch === upstream.defaultBranch
  )
    throw new DevkitError(
      'usage',
      'SOURCE_BRANCH_INVALID',
      'Contributions require a dedicated managed branch.',
    );
  if (
    settings.originUrls.length !== 1 ||
    settings.pushUrls.length !== 1 ||
    settings.upstreamUrls.length !== 1 ||
    settings.hasRewrite ||
    settings.isMirror ||
    settings.receivePack !== null
  )
    throw unsafe();
  if (origin.parent === undefined || origin.personalOwner === null) throw unverified();
  if (
    origin.personalOwner !== input.user ||
    !origin.parent ||
    !sameRef(origin.parent, upstream.ref) ||
    sameRef(origin.ref, upstream.ref)
  )
    throw unsafe();
  const url = settings.pushUrls[0]!;
  if (
    !matches(url, origin.cloneUrls) ||
    !matches(settings.originUrls[0]!, origin.cloneUrls) ||
    !matches(settings.upstreamUrls[0]!, upstream.cloneUrls)
  )
    throw unsafe();
  return {
    url,
    fingerprint: settings.fingerprint,
    source: origin.ref,
    target: upstream.ref,
    targetBranch: upstream.defaultBranch,
  };
}

function sameRef(a: RepoRef, b: RepoRef): boolean {
  return a.project === b.project && a.name === b.name;
}

function matches(url: string, advertised: readonly string[]): boolean {
  const normalized = normalizeTransport(url);
  return advertised.some((candidate) => normalizeTransport(candidate) === normalized);
}

function normalizeTransport(value: string): string {
  if (!value || /[\x00-\x1f\x7f]/u.test(value)) throw unsafe();
  if (/^[a-z]:[\\/]/i.test(value)) return windowsTransport(value);
  if (value.startsWith('/')) return value.replace(/\/+$/, '').replace(/\.git$/, '');
  if (/\s/u.test(value)) throw unsafe();
  const scp = /^([^/@:]+@[^/:]+):(.+)$/.exec(value);
  const normalized = scp ? `ssh://${scp[1]}/${scp[2]}` : value;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw unsafe();
  }
  if (
    !['ssh:', 'https:', 'file:'].includes(url.protocol) ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol === 'https:' && url.username)
  )
    throw unsafe();
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\.git$/, '');
  if (url.protocol === 'file:' && !url.hostname && /^\/[a-z]:\//i.test(url.pathname))
    return windowsTransport(decodeURIComponent(url.pathname.slice(1)));
  return url.toString();
}

function windowsTransport(value: string): string {
  const normalized = path.win32
    .normalize(value)
    .replaceAll('\\', '/')
    .toLowerCase()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
  return `file:///${normalized
    .split('/')
    .map((part, index) => (index === 0 ? part : encodeURIComponent(part)))
    .join('/')}`;
}

function unsafe(): DevkitError {
  return new DevkitError(
    'conflict',
    'SOURCE_REMOTE_UNSAFE',
    'Source remotes do not identify one verified personal fork and its upstream.',
    {
      hint: 'Review origin and upstream, including push URLs and URL rewrites. No remote was changed.',
      nextSteps: [
        'Inspect the source Git remote configuration.',
        'Verify the fork owner and parent, then retry.',
      ],
    },
  );
}

function unverified(): DevkitError {
  return new DevkitError(
    'config',
    'SOURCE_IDENTITY_UNVERIFIED',
    'The companion did not establish personal fork ownership and parentage.',
    {
      hint: 'Use a companion version that exposes repository parent identity; matching a URL is insufficient.',
      nextSteps: ['fx doctor', 'Verify the personal fork and update the companion CLI.'],
      handoff: {
        summary: 'Repository identity evidence is incomplete.',
        userSteps: [
          {
            id: 'source-parent',
            kind: 'manual',
            title: 'Use a companion CLI that reports the personal fork and its parent repository.',
          },
        ],
      },
    },
  );
}
