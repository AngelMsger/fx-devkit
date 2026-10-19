// Discovery may quarantine invalid entries; preparation must preserve the declared scope.
import { DevkitError } from '../../domain/errors.js';
import { droppedEntryOf, mapEntryIndex } from '../../domain/manifest/quarantine.js';

import type { ManifestBundle } from './load.js';

export function requireUsableManifest(bundle: ManifestBundle): void {
  const documents = [
    bundle.workspace,
    bundle.environments,
    bundle.tools,
    bundle.harness,
    bundle.members,
  ];
  const problems = documents.flatMap(
    (document) =>
      document?.result.problems.map((problem) => {
        const entry = droppedEntryOf(problem, document.result.dropped);
        return {
          file: document.path ?? 'manifest/tools.yaml',
          ...problem,
          ...(entry
            ? { entry: entry.name, path: mapEntryIndex(problem.path, entry.collection, () => '') }
            : {}),
        };
      }) ?? [],
  );
  if (problems.length === 0) return;
  throw new DevkitError(
    'config',
    'MANIFEST_INVALID',
    'The manifest cannot prepare the declared workspace',
    {
      hint: problems
        .map(
          (problem) =>
            `${problem.file}:${problem.path}${problem.entry ? ` (${problem.entry})` : ''}: ${problem.message}`,
        )
        .join('\n'),
      nextSteps: [
        'Correct the listed fields in the manifest source, then retry the same initialization.',
      ],
      partialResult: { validation: { ok: false, problems } },
    },
  );
}
