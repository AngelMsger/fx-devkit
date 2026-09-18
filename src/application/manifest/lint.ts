// `manifest lint`: the documents' advice from the domain, plus a look at
// every team Skill directory of the checkout. Never fails.

import path from 'node:path';

import { lintManifest, type LintFinding } from '../../domain/manifest/lint.js';
import { loadToolsDocument, loadToolsPatchDocument } from '../../domain/manifest/loader.js';
import { bindPlatforms, type ProviderCatalog } from '../../domain/manifest/providers.js';
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

export class LintManifest {
  constructor(
    private readonly fs: FileReader,
    private readonly bundledTools: () => string,
    private readonly describeProvider: (
      id: string,
    ) => { readonly recipes: readonly SetupRecipe[] } | undefined = () => undefined,
  ) {}

  async execute(input: LintManifestInput): Promise<LintFinding[]> {
    const validation = await new ValidateManifest(this.fs, this.bundledTools).execute({
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

    const bundle = await new LoadManifest(this.fs, this.bundledTools).execute({
      ...input,
    });
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
            : [
                [
                  binding.provider,
                  setupHints(this.describeProvider(binding.provider)?.recipes ?? []),
                ],
              ],
        ),
      ),
      ...(bundle.environments === undefined
        ? {}
        : { environments: bundle.environments.result.doc }),
      ...(patch === undefined
        ? {}
        : {
            tools: {
              base: loadToolsDocument(this.bundledTools(), input).doc,
              patch: loadToolsPatchDocument(patch, input).doc,
            },
          }),
    });
    return [...documents, ...(await this.skills(input.dir))];
  }

  private async skills(dir: string): Promise<LintFinding[]> {
    const root = teamSkillsRoot(dir);
    const findings: LintFinding[] = [];
    for (const name of (await this.fs.readDir(root)).sort()) {
      if (!(await this.fs.isDirectory(path.join(root, name)))) continue;
      findings.push(...lintSkill(name, await this.fs.readText(path.join(root, name, 'SKILL.md'))));
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
            .filter((key) => key.startsWith('setup.') && !recipe.defaults?.[key]?.trim())
            .map((key) => key.slice('setup.'.length)),
        ),
    ),
  ];
}
