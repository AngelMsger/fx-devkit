// Everything the templates read, taken from one loaded manifest.

import type { TemplateInput } from '../../domain/docs/templates.js';
import type { FileSystem } from '../../ports/fs.js';
import type { LoginDeps } from '../login/deps.js';
import type { ManifestContext } from '../manifest/context.js';
import { toolsOf } from '../tool/toolchain.js';

import { skillCatalog } from './skill-catalog.js';

export async function templateInputOf(
  context: ManifestContext,
  login: Pick<LoginDeps, 'describeProvider'>,
  fs: FileSystem,
): Promise<TemplateInput> {
  return {
    teamSkills: await skillCatalog(fs, context.dir),
    workspace: context.bundle.workspace.result.doc,
    environments: context.bundle.environments?.result.doc,
    bindings: context.bindings,
    platforms: context.platforms,
    tools: toolsOf(context.bundle),
    toolsOf: (provider: string) => login.describeProvider(provider)?.tools ?? [provider],
  };
}
