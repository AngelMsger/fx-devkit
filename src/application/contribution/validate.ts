// Contributions validate their captured candidate with the existing manifest
// inspectors. Boundary checks precede parsing; reports omit untrusted values.

import path from 'node:path';

import { scanBoundary } from '../../domain/boundary/scan.js';
import type { ContributionFile } from '../../domain/contribution/snapshot.js';
import { MANIFEST_FILES } from '../../domain/manifest/files.js';
import type { SetupRecipe } from '../../domain/setup/types.js';
import type { SnapshotViews } from '../../ports/snapshot-views.js';
import { LintManifest } from '../manifest/lint.js';
import { ValidateManifest } from '../manifest/validate.js';

interface ContributionValidationInput {
  readonly files: Readonly<Record<string, string>>;
  readonly changes: readonly ContributionFile[];
  readonly cliVersion: string;
}

export interface ContributionFinding {
  readonly path: string;
  readonly rule: string;
  readonly line: number | null;
  readonly column: number | null;
}

export interface ContributionValidation {
  readonly ok: boolean;
  readonly findings: readonly ContributionFinding[];
}

export class ValidateContribution {
  constructor(
    private readonly views: SnapshotViews,
    private readonly bundledTools: () => string,
    private readonly describeProvider: (
      id: string,
    ) => { readonly recipes: readonly SetupRecipe[] } | undefined = () => undefined,
  ) {}

  async execute(input: ContributionValidationInput): Promise<ContributionValidation> {
    const names = input.changes.flatMap((file, index) =>
      scanBoundary({ text: file.path, policy: 'manifest' }).map((item) => ({
        ...item,
        path: `(protected path ${index + 1})`,
      })),
    );
    if (names.length) return { ok: false, findings: names };
    const mismatch = input.changes.find(
      (file) => (input.files[file.path] ?? null) !== file.content,
    );
    if (mismatch) return { ok: false, findings: [finding(mismatch.path, 'snapshot-mismatch')] };
    const findings: ContributionFinding[] = input.changes.flatMap((file) =>
      scanBoundary({ text: file.content ?? '', policy: 'manifest' }).map((finding) => ({
        ...finding,
        path: file.path,
      })),
    );
    if (findings.length > 0) return { ok: false, findings };
    const view = this.views.open(input.files);
    if (!(await view.reader.exists(path.join(view.root, MANIFEST_FILES.workspace))))
      return { ok: false, findings: [finding(MANIFEST_FILES.workspace, 'manifest-missing')] };
    const options = { dir: view.root, cliVersion: input.cliVersion };
    const validation = await new ValidateManifest(view.reader, this.bundledTools).execute({
      ...options,
      strict: true,
    });
    for (const document of validation.documents) {
      if (
        document.problems.length > 0 ||
        document.unknown.length > 0 ||
        document.dropped.length > 0
      )
        findings.push(finding(document.path, 'manifest-invalid'));
    }
    if (findings.length > 0) return { ok: false, findings };
    const lint = await new LintManifest(
      view.reader,
      this.bundledTools,
      this.describeProvider,
    ).execute(options);
    for (const item of lint) findings.push(finding(item.kind, 'manifest-lint'));
    return { ok: findings.length === 0, findings };
  }
}

function finding(path: string, rule: string): ContributionFinding {
  return { path, rule, line: null, column: null };
}
