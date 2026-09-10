// What both docs use cases share: the input flags, one row per file with
// the action taken or previewed, and the ending — object under --check,
// write nothing under --dry-run, otherwise write what changed.

import type { RenderedRegions } from '../../domain/docs/regions.js';
import { begin, end } from '../../domain/docs/regions.js';
import { DevkitError } from '../../domain/errors.js';
import type { FileSystem } from '../../ports/fs.js';
import type { ReplaceFiles } from '../../ports/replace-files.js';
import type { Reporter } from '../../ports/reporter.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';

export interface RenderInput {
  readonly replace?: ReplaceFiles;
  readonly check: boolean;
  readonly dryRun: boolean;
  readonly out?: string | undefined;
  readonly posture: WritePosture;
}

export interface RenderedFile {
  readonly path: string;
  readonly action: 'created' | 'updated' | 'unchanged' | 'foreign';
  readonly replaced: readonly string[];
  readonly missing: readonly string[];
  readonly unknown: readonly string[];
}

export interface RenderOutput {
  readonly files: readonly RenderedFile[];
}

export interface Pending {
  readonly file: RenderedFile;
  readonly text: string;
}

export function actionFor(current: string | undefined, next: string): RenderedFile['action'] {
  if (current === undefined) return 'created';
  return current === next ? 'unchanged' : 'updated';
}

export function pending(
  path: string,
  action: RenderedFile['action'],
  text: string,
  regions?: RenderedRegions,
): Pending {
  return {
    text,
    file: {
      path,
      action,
      replaced: regions?.replaced ?? [],
      missing: regions?.missing ?? [],
      unknown: regions?.unknown ?? [],
    },
  };
}

export function reportRegions(reporter: Reporter, source: string, file: RenderedFile): void {
  for (const name of file.missing) {
    reporter.notice({
      code: 'DOCS_REGION_MISSING',
      message: `${source} has no "${name}" region; paste these markers where it belongs and render again`,
      nextSteps: [begin(name), end(name)],
    });
  }
  for (const name of file.unknown)
    reporter.notice({
      code: 'DOCS_REGION_UNKNOWN',
      message: `${source} contained a "${name}" region this fx does not generate; only standalone retired blocks are removed`,
    });
}

export async function finish(
  fs: FileSystem,
  input: RenderInput,
  files: readonly Pending[],
): Promise<RenderOutput> {
  const output = { files: files.map((f) => f.file) };
  const stale = files.filter((f) => f.file.action === 'created' || f.file.action === 'updated');
  if (input.check) {
    if (stale.length === 0) return output;
    throw new DevkitError(
      'conflict',
      'DOCS_STALE',
      `${stale.map((f) => f.file.path).join(', ')} differ${stale.length === 1 ? 's' : ''} from the manifest`,
      {
        hint: 'The generated regions no longer match the manifest.',
        nextSteps: ['fx sync --only docs', 'fx manifest render'],
      },
    );
  }
  if (input.dryRun || stale.length === 0) return output;
  assertWritable(input.posture, 'docs');
  for (const f of stale) await fs.writeText(f.file.path, f.text);
  return output;
}
