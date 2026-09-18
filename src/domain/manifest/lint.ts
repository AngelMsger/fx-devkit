// Advice about a manifest that is valid but could be tidier. Nothing here
// blocks a load; `manifest lint` always exits 0.

import { releasePolicyOf } from '../release/policy.js';

import { bindPlatforms, type ProviderCatalog } from './providers.js';
import type { Environments, Toolchain, Workspace } from './types.js';

export interface LintFinding {
  readonly kind: 'workspace' | 'environments' | 'tools' | 'members' | 'harness' | 'skills';
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface LintInput {
  readonly workspace: Workspace;
  readonly providers: ProviderCatalog;
  readonly ownedRepos?: readonly string[];
  readonly providerSetupHints?: Readonly<Record<string, readonly string[]>>;
  readonly environments?: Environments;
  readonly tools?: { readonly base: Toolchain; readonly patch: Toolchain };
}

export function lintManifest(input: LintInput): LintFinding[] {
  return [
    ...lintWorkspace(input.workspace, input.ownedRepos),
    ...(input.environments === undefined
      ? []
      : lintEnvironments(input.environments, input.providers, input.providerSetupHints ?? {})),
    ...(input.environments === undefined
      ? []
      : lintRelease(input.workspace, input.environments, input.providers)),
    ...(input.tools === undefined ? [] : lintToolsPatch(input.tools.base, input.tools.patch)),
  ];
}

function lintWorkspace(doc: Workspace, ownedRepos: readonly string[] | undefined): LintFinding[] {
  const findings: LintFinding[] = [];
  const add = (code: string, path: string, message: string): void => {
    findings.push({ kind: 'workspace', code, path, message });
  };
  if (doc.providers === undefined) {
    add(
      'PROVIDERS_MISSING',
      'providers',
      'schema 1 document: add `providers` to name the code host explicitly (schema 2)',
    );
  }
  const { defaults } = doc;
  const used = new Map<string, number>();
  doc.repos.forEach((repo, i) => {
    if (ownedRepos !== undefined && !ownedRepos.includes(repo.name))
      add(
        'REPO_NO_OWNER',
        `repos[${i}]`,
        'no ownership scenario in the readable members document covers this repository',
      );
    if (repo.path === repo.name)
      add('REDUNDANT_FIELD', `repos[${i}].path`, 'restates the repository name');
    if (repo.branch !== undefined && repo.branch === defaults.branch) {
      add('REDUNDANT_FIELD', `repos[${i}].branch`, 'restates defaults.branch');
    }
    if (repo.project !== undefined && repo.project === defaults.upstream_project) {
      add('REDUNDANT_FIELD', `repos[${i}].project`, 'restates defaults.upstream_project');
    }
    const project = repo.project ?? defaults.upstream_project;
    if (project !== undefined && !used.has(project)) used.set(project, i);
  });
  const projects = doc.projects;
  if (projects !== undefined && Object.keys(projects).length > 0) {
    doc.repos.forEach((repo, i) => {
      const project = repo.project ?? defaults.upstream_project;
      if (repo.project !== undefined && project !== undefined && !(project in projects)) {
        add(
          'PROJECT_UNDECLARED',
          `repos[${i}].project`,
          `"${project}" is not declared under projects, so nobody knows who grants access`,
        );
      }
    });
    for (const [name, project] of Object.entries(projects)) {
      if (!used.has(name))
        add('PROJECT_UNUSED', `projects.${name}`, 'declared but no repository uses it');
      else if (!project.contact?.trim())
        add(
          'PROJECT_NO_CONTACT',
          `projects.${name}`,
          'in use but names no contact for access requests',
        );
    }
  }
  return findings;
}

function lintEnvironments(
  doc: Environments,
  providers: ProviderCatalog,
  setupHints: Readonly<Record<string, readonly string[]>>,
): LintFinding[] {
  const findings: LintFinding[] = [];
  const add = (code: string, path: string, message: string): void => {
    findings.push({ kind: 'environments', code, path, message });
  };
  for (const binding of bindPlatforms(doc, providers)) {
    const requiredHints = binding.provider === null ? [] : (setupHints[binding.provider] ?? []);
    for (const [env, spec] of Object.entries(doc.envs)) {
      const coordinate = spec.platforms?.[binding.platform];
      if (coordinate === undefined || coordinate.confidence === 'not_covered') continue;
      const missing = requiredHints.filter((key) => !coordinate.setup?.[key]?.trim());
      if (missing.length > 0)
        add(
          'PLATFORM_NO_SETUP',
          `envs.${env}.platforms.${binding.platform}.setup`,
          `advisory: manual or file setup guidance lacks ${missing.join(', ')}; record the appropriate entry points without inventing them`,
        );
    }
    const path = `platforms.${binding.platform}`;
    if (binding.source === 'default')
      add(
        'PLATFORM_PROVIDER_IMPLIED',
        path,
        `served by ${binding.provider} only because of its name; write provider and capability (schema 2)`,
      );
    else if (binding.source === 'unbound')
      add(
        'PLATFORM_UNBOUND',
        path,
        'names no provider and no default is known; login and can cannot serve it',
      );
  }
  for (const [name, env] of Object.entries(doc.envs)) {
    if (env.label === undefined)
      add('ENV_NO_LABEL', `envs.${name}`, 'no label; listings will show the raw name');
  }
  return findings;
}

// The errors check needs an environment and, per repository, an error
// tracker coordinate in it; a checklist entry without one is quietly "not
// checked", which is worth knowing before release day.
function lintRelease(
  workspace: Workspace,
  environments: Environments,
  providers: ProviderCatalog,
): LintFinding[] {
  const release = workspace.release;
  if (release === undefined) return [];
  const env = release.env;
  if (env === undefined) {
    return [
      {
        kind: 'workspace',
        code: 'RELEASE_ENV_UNSET',
        path: 'release.env',
        message: 'names no environment, so fx release never checks errors',
      },
    ];
  }
  const tracker = bindPlatforms(environments, providers).find(
    (b) => b.capability === 'error-tracker',
  );
  const onEnv =
    tracker === undefined ? undefined : environments.envs[env]?.platforms?.[tracker.platform];
  const declared = onEnv !== undefined && onEnv.confidence !== 'not_covered';
  return workspace.repos.flatMap((repo, i) => {
    const policy = releasePolicyOf(workspace, repo.name);
    const own = tracker === undefined ? undefined : repo.obs?.overrides?.[tracker.platform]?.[env];
    const has = declared && repo.obs?.covered !== false && own?.confidence !== 'not_covered';
    if (!policy.covered || has) return [];
    return [
      {
        kind: 'workspace' as const,
        code: 'RELEASE_COVERAGE_GAP',
        path: `repos[${i}].release`,
        message: `has no error tracker coordinate in ${env}; fx release reports its errors as not checked`,
      },
    ];
  });
}

function lintToolsPatch(base: Toolchain, patch: Toolchain): LintFinding[] {
  const findings: LintFinding[] = [];
  const baseByName = new Map(base.tools.map((t) => [t.name, t as Record<string, unknown>]));
  patch.tools.forEach((tool, i) => {
    const original = baseByName.get(tool.name);
    if (original === undefined) return;
    for (const [field, value] of Object.entries(tool)) {
      if (field !== 'name' && sameValue(value, original[field])) {
        findings.push({
          kind: 'tools',
          code: 'PATCH_NOOP',
          path: `tools[${i}].${field}`,
          message: 'repeats the bundled baseline; the patch only needs what differs',
        });
      }
    }
  });
  return findings;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
