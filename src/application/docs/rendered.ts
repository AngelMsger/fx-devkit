// Apply document plans against captured snapshots and retain per-file outcomes
// when a later write fails. A planned action is not evidence of a completed write.

import path from 'node:path';

import type { RenderedRegions } from '../../domain/docs/regions.js';
import { begin, end } from '../../domain/docs/regions.js';
import {
  asDevkitError,
  DevkitError,
  toEnvelope,
  withPartialResult,
  type ErrorEnvelope,
} from '../../domain/errors.js';
import type { EffectOutcome } from '../../domain/outcome.js';
import { isLostWrite } from '../../domain/projection.js';
import type {
  ProjectionPath,
  ProjectionSnapshot,
  ProjectionStore,
} from '../../ports/projection.js';
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
  readonly action: 'created' | 'updated' | 'removed' | 'unchanged' | 'foreign';
  readonly result: EffectOutcome;
  readonly failure?: ErrorEnvelope['error'];
  readonly replaced: readonly string[];
  readonly missing: readonly string[];
  readonly added: readonly string[];
  readonly unknown: readonly string[];
}

export interface RenderOutput {
  readonly files: readonly RenderedFile[];
}

// A null text removes the file.
export interface PendingFile {
  readonly file: RenderedFile;
  readonly text: string | null;
  readonly before: ProjectionSnapshot;
}

const CHANGES: ReadonlySet<RenderedFile['action']> = new Set(['created', 'updated', 'removed']);

export function actionFor(current: string | undefined, next: string): RenderedFile['action'] {
  if (current === undefined) return 'created';
  return current === next ? 'unchanged' : 'updated';
}

export function pending(
  path: string,
  action: RenderedFile['action'],
  text: string | null,
  before: ProjectionSnapshot,
  regions?: RenderedRegions,
): PendingFile {
  return {
    text,
    before,
    file: {
      path,
      action,
      result: CHANGES.has(action) ? 'planned' : 'skipped',
      replaced: regions?.replaced ?? [],
      missing: regions?.missing ?? [],
      added: regions?.added ?? [],
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
  store: ProjectionStore,
  input: RenderInput,
  files: readonly PendingFile[],
): Promise<RenderOutput> {
  const output = { files: files.map((f) => f.file) };
  const stale = files.filter((f) => CHANGES.has(f.file.action));
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
  for (const f of stale) {
    const index = files.indexOf(f);
    try {
      const result = await store.write({
        ...documentPath(f.file.path),
        before: f.before,
        text: f.text,
      });
      if (isLostWrite(result)) throw documentConflict(f.file.path);
      output.files[index] = { ...f.file, result: result === 'written' ? 'done' : 'skipped' };
    } catch (error) {
      const failure = toEnvelope(asDevkitError(error)).error;
      output.files[index] = { ...f.file, result: 'failed', failure };
      for (let pending = index + 1; pending < output.files.length; pending++) {
        const file = output.files[pending]!;
        if (file.result === 'planned') output.files[pending] = { ...file, result: 'not_started' };
      }
      throw withPartialResult(error, output);
    }
  }
  return output;
}

export function documentPath(file: string): ProjectionPath {
  const absolute = path.resolve(file);
  return { root: path.dirname(absolute), relative: path.basename(absolute) };
}

export function documentConflict(file: string): DevkitError {
  return new DevkitError(
    'conflict',
    'DOCS_WRITE_CONFLICT',
    `The document changed or cannot be safely replaced: ${file}`,
    {
      hint: 'Concurrent edits and non-regular paths are preserved.',
      nextSteps: ['Inspect the reported path, then preview and retry the same docs command.'],
    },
  );
}
