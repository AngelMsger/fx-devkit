// `manifest lint`: the documents' advice from the domain, plus a look at
// every team Skill directory of the checkout. Never fails.

import path from 'node:path';

import { lintManifest, type LintFinding } from '../../domain/manifest/lint.js';
import { loadToolsDocument, loadToolsPatchDocument } from '../../domain/manifest/loader.js';
import { bindPlatforms, type ProviderCatalog } from '../../domain/manifest/providers.js';
import { setupKeyOf } from '../../domain/setup/names.js';
import type { SetupRecipe } from '../../domain/setup/types.js';
import { lintSkill } from '../../domain/skills/lint.js';
import { placeholders } from '../../domain/template.js';
import type { FileReader } from '../../ports/fs.js';
import { teamSkillsRoot } from '../skill/observe.js';

import { LoadManifest } from './load.js';
import { ValidateManifest } from './validate.js';

export interface LintManifestInput {
  readonly dir: string;
  readonly cliVersion: string;
  readonly providers: ProviderCatalog;
}

export interface LintManifestDeps {
  readonly fs: FileReader;
  readonly bundledTools: () => string;
  // A bound provider's setup recipes; without it no platform is linted for the setup values
  // its provider needs.
  readonly describeProvider?:
    ((id: string) => { readonly recipes: readonly SetupRecipe[] } | undefined) | undefined;
}

export class LintManifest {
  constructor(private readonly deps: LintManifestDeps) {}

  async execute(input: LintManifestInput): Promise<LintFinding[]> {
    const { fs, bundledTools, describeProvider } = this.deps;
    const validation = await new ValidateManifest(fs, bundledTools).execute({
      ...input,
      strict: false,
    });
    const invalid: LintFinding[] = validation.documents.flatMap((document) =>
      document.problems.map((problem) => ({
        kind: document.kind,
        code: 'MANIFEST_INVALID',
        path: problem.path,
        message: problem.message,
      })),
    );
    if (invalid.length > 0) return [...invalid, ...(await this.skills(input.dir))];

    const bundle = await new LoadManifest({ fs, bundledTools }).execute({ ...input });
    const patch = bundle.tools.patchText;
    const members = bundle.members?.result.doc;
    const environmentDoc = bundle.environments?.result.doc;
    const documents = lintManifest({
      workspace: bundle.workspace.result.doc,
      providers: input.providers,
      ...(members === undefined
        ? {}
        : {
            ownedRepos: (members.areas ?? []).flatMap((area) =>
              (area.scenarios ?? []).flatMap((scenario) => scenario.repos ?? []),
            ),
          }),
      providerSetupHints: Object.fromEntries(
        (environmentDoc === undefined
          ? []
          : bindPlatforms(environmentDoc, input.providers)
        ).flatMap((binding) =>
          binding.provider === null
            ? []
            : [[binding.provider, setupHints(describeProvider?.(binding.provider)?.recipes ?? [])]],
        ),
      ),
      ...(bundle.environments === undefined
        ? {}
        : { environments: bundle.environments.result.doc }),
      ...(patch === undefined
        ? {}
        : {
            tools: {
              base: loadToolsDocument(bundledTools(), input).doc,
              patch: loadToolsPatchDocument(patch, input).doc,
            },
          }),
    });
    return [...documents, ...(await this.skills(input.dir))];
  }

  private async skills(dir: string): Promise<LintFinding[]> {
    const { fs } = this.deps;
    const root = teamSkillsRoot(dir);
    const findings: LintFinding[] = [];
    for (const name of (await fs.readDir(root)).sort()) {
      if (!(await fs.isDirectory(path.join(root, name)))) continue;
      findings.push(...lintSkill(name, await fs.readText(path.join(root, name, 'SKILL.md'))));
    }
    return findings;
  }
}

function setupHints(recipes: readonly SetupRecipe[]): string[] {
  return [
    ...new Set(
      recipes
        .filter((recipe) => recipe.perEnv && (recipe.kind === 'file' || recipe.kind === 'manual'))
        .flatMap((recipe) =>
          [recipe.open ?? '', recipe.instructions ?? '']
            .flatMap(placeholders)
            .filter((name) => !recipe.defaults?.[name]?.trim())
            .flatMap((name) => setupKeyOf(name) ?? []),
        ),
    ),
  ];
}
