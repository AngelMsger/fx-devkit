// Cross-field rules of environments.yaml, plus the cross-document checks
// that a repository's overrides and the release policy only name platforms
// and environments that exist. An undeclared platform is a contradiction,
// not a suggestion.

import { isSemver } from '../../semver.js';
import type { ProviderCatalog } from '../providers.js';
import type { Environments, Problem, Workspace } from '../types.js';

import { serviceRules } from './services.js';

export function environmentsRules(
  doc: Environments,
  providers: ProviderCatalog | undefined,
): Problem[] {
  const problems: Problem[] = [];
  if (doc.min_cli !== undefined && !isSemver(doc.min_cli)) {
    problems.push({ path: 'min_cli', message: 'must be a semantic version' });
  }
  if (Object.keys(doc.platforms).length === 0) {
    problems.push({ path: 'platforms', message: 'must declare at least one platform' });
  }
  if (Object.keys(doc.envs).length === 0) {
    problems.push({ path: 'envs', message: 'must declare at least one environment' });
  }
  for (const [envName, env] of Object.entries(doc.envs)) {
    for (const platform of Object.keys(env.platforms ?? {})) {
      if (!(platform in doc.platforms)) {
        problems.push({
          path: `envs.${envName}.platforms.${platform}`,
          message: `platform "${platform}" is not declared under platforms`,
        });
      }
      const base = doc.platforms[platform];
      const override = env.platforms?.[platform];
      if (base?.service || override?.service)
        problems.push(
          ...serviceRules({
            providers,
            // A schema 1 platform names no provider; its own name is what the
            // document offers, and a name no provider answers to is reported as one.
            provider: base?.provider ?? platform,
            service: { ...base?.service, ...override?.service },
            vars: { ...base?.vars, ...override?.vars },
            path: `envs.${envName}.platforms.${platform}.service`,
          }),
        );
    }
  }
  return problems;
}

export function obsReferenceRules(workspace: Workspace, environments: Environments): Problem[] {
  const problems: Problem[] = [];
  workspace.repos.forEach((repo, i) => {
    for (const [platform, byEnv] of Object.entries(repo.obs?.overrides ?? {})) {
      const base = `repos[${i}].obs.overrides.${platform}`;
      if (!(platform in environments.platforms)) {
        problems.push({
          path: base,
          message: `platform "${platform}" is not declared in environments.yaml`,
        });
        continue;
      }
      for (const env of Object.keys(byEnv)) {
        if (!(env in environments.envs)) {
          problems.push({
            path: `${base}.${env}`,
            message: `environment "${env}" is not declared in environments.yaml`,
          });
        }
      }
    }
  });
  const known = new Set(workspace.repos.map((repo) => repo.name));
  for (const [env, value] of Object.entries(environments.envs)) {
    for (const [platform, coordinate] of Object.entries(value.platforms ?? {})) {
      for (const repo of Object.keys(coordinate.observations ?? {})) {
        if (!known.has(repo))
          problems.push({
            path: `envs.${env}.platforms.${platform}.observations.${repo}`,
            message: 'observation must name a shared repository',
          });
      }
    }
  }
  return problems;
}

export function releaseReferenceRules(workspace: Workspace, environments: Environments): Problem[] {
  const problems: Problem[] = [];
  const check = (path: string, env: string | undefined): void => {
    if (env !== undefined && !(env in environments.envs)) {
      problems.push({ path, message: `environment "${env}" is not declared in environments.yaml` });
    }
  };
  check('release.env', workspace.release?.env);
  check('release.ci.source_env', workspace.release?.ci?.source_env);
  check('release.ci.target_env', workspace.release?.ci?.target_env);
  workspace.repos.forEach((repo, i) => {
    check(`repos[${i}].release.ci.source_env`, repo.release?.ci?.source_env);
    check(`repos[${i}].release.ci.target_env`, repo.release?.ci?.target_env);
  });
  return problems;
}
