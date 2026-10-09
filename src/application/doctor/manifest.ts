// Revalidate declarations tolerated during discovery and check generated guides.
// Missing, stale or foreign required guides block preparation even at warning severity.

import { DevkitError } from '../../domain/errors.js';
import { codeHostBinding } from '../../domain/manifest/providers.js';
import { DeriveDocs } from '../docs/derive.js';
import type { LoginDeps } from '../login/deps.js';
import { LintManifest } from '../manifest/lint.js';
import { ValidateManifest } from '../manifest/validate.js';
import type { ManifestUpdateCheck } from '../update/manifest.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceCommand } from '../workspace/guidance.js';

import { NOT_CHECKED } from './self.js';
import { finding, type Finding } from './types.js';

export async function checkManifest(
  deps: WorkspaceDeps,
  login: Pick<LoginDeps, 'describeProvider'>,
  bundledTools: () => string,
  upstream: UpstreamCheck,
): Promise<Finding[]> {
  const input = {
    dir: deps.ctx.manifest.dir,
    cliVersion: deps.cliVersion,
    providers: deps.ctx.providers,
  };
  const report = await new ValidateManifest(deps.fs, bundledTools).execute({
    ...input,
    strict: false,
  });
  const findings = codeHostCoverage(deps);
  for (const doc of report.documents) {
    for (const p of doc.problems)
      findings.push(
        finding('manifest', `${doc.kind}:${p.path}`, 'fail', p.message, {
          fix: workspaceCommand(deps, 'manifest', 'validate'),
        }),
      );
    for (const d of doc.dropped)
      findings.push(
        finding('manifest', `${doc.kind}:${d.name}`, 'fail', `entry skipped: ${d.reason}`, {
          fix: workspaceCommand(deps, 'manifest', 'validate'),
        }),
      );
  }
  for (const binding of deps.ctx.platforms) {
    if (binding.source === 'unbound')
      findings.push(
        finding(
          'manifest',
          `environments:platforms.${binding.platform}`,
          'fail',
          'no provider serves this platform',
          {
            fix: workspaceCommand(deps, 'manifest', 'providers'),
          },
        ),
      );
  }
  for (const lint of await new LintManifest(deps.fs, bundledTools, login.describeProvider).execute(
    input,
  ))
    findings.push(
      finding('manifest', `${lint.kind}:${lint.path}`, 'warn', `${lint.code}: ${lint.message}`, {
        fix: workspaceCommand(deps, 'manifest', 'lint'),
      }),
    );
  const docs = await checkDocs(deps, login);
  if (findings.length === 0 && docs.level === 'ok')
    findings.push(finding('manifest', 'all', 'ok', 'valid, nothing to tidy'));
  findings.push(docs, await checkUpstream(deps, upstream));
  return findings;
}

interface UpstreamCheck {
  readonly manifest: ManifestUpdateCheck;
  readonly enabled: boolean;
}

async function checkUpstream(deps: WorkspaceDeps, check: UpstreamCheck): Promise<Finding> {
  if (!check.enabled)
    return finding('manifest', 'upstream', 'ok', NOT_CHECKED, { coverage: 'not_applicable' });
  const v = await check.manifest.execute({
    workspace: deps.ctx.name,
    sourceDir: deps.ctx.manifestDir,
    force: true,
  });
  if (v.source === 'skipped')
    return finding(
      'manifest',
      'upstream',
      'ok',
      'the source is not a repository; nothing to check',
      { coverage: 'not_applicable' },
    );
  if (v.error !== undefined)
    return finding('manifest', 'upstream', 'warn', `could not reach upstream: ${v.error}`, {
      coverage: 'incomplete',
    });
  if (v.behind)
    return finding('manifest', 'upstream', 'warn', 'new commits upstream since the last fx sync', {
      fix: workspaceCommand(deps, 'sync'),
    });
  return finding('manifest', 'upstream', 'ok', 'up to date with upstream');
}

async function checkDocs(
  deps: WorkspaceDeps,
  login: Pick<LoginDeps, 'describeProvider'>,
): Promise<Finding> {
  try {
    const out = await new DeriveDocs(deps, login).execute({
      check: true,
      dryRun: true,
      posture: { readOnly: true, source: 'default' },
    });
    const foreign = out.files.filter((f) => f.action === 'foreign').map((f) => f.path);
    if (foreign.length > 0)
      return finding('manifest', 'docs', 'warn', `${foreign.join(', ')} not written by fx`, {
        required: true,
        fix: `Move the file aside, then ${workspaceCommand(deps, 'sync', '--only', 'docs')}`,
      });
    return finding('manifest', 'docs', 'ok', 'the root AGENTS.md matches the manifest');
  } catch (err) {
    if (err instanceof DevkitError && err.code === 'DOCS_REGIONS_INVALID')
      return finding('manifest', 'docs', 'fail', err.message, {
        required: true,
        fix: err.nextSteps[0],
      });
    if (!(err instanceof DevkitError) || err.code !== 'DOCS_STALE') throw err;
    return finding('manifest', 'docs', 'warn', err.message, {
      required: true,
      fix: workspaceCommand(deps, 'sync', '--only', 'docs'),
    });
  }
}

function codeHostCoverage(deps: WorkspaceDeps): Finding[] {
  if (codeHostBinding(deps.ctx.bindings).provider !== null) return [];
  return [
    finding(
      'manifest',
      'provider:code-host',
      'warn',
      'No code-host provider is declared. Git synchronization is available; hosted API readiness is not covered.',
      { coverage: 'not_applicable', fix: 'fx manifest providers' },
    ),
  ];
}
