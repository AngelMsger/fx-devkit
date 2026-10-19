// Translate each stage's typed results into preparation evidence at its owning boundary.
import { isUnfinished } from '../../domain/outcome.js';
import { preparationCheck, type PreparationCheck } from '../../domain/preparation.js';
import type { RenderedFile } from '../docs/rendered.js';
import { toolRecovery } from '../preparation.js';
import type { SkillStageOutput } from '../skill/types.js';
import type { ToolStatus } from '../tool/check.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import type { GoWorkOutput } from '../workspace/go-work.js';

export function documentChecks(files: readonly RenderedFile[]): PreparationCheck[] {
  return files.map((file) =>
    preparationCheck(
      `docs:${file.path}`,
      file.action === 'foreign' || isUnfinished(file.result) ? 'blocked' : 'ready',
      file.action === 'foreign' ? 'An existing guide needs replacement approval' : file.result,
      { resource: file.path, owner: 'user', ...(file.failure ? { failure: file.failure } : {}) },
    ),
  );
}

// A person's own go.work stays in charge of their builds; that is worth a warning,
// not a blocker.
export function goWorkChecks(output: GoWorkOutput): PreparationCheck[] {
  const { file } = output;
  if (file === null) return [];
  const foreign = file.action === 'foreign';
  return [
    preparationCheck(
      `go:${file.path}`,
      foreign ? 'blocked' : 'ready',
      foreign ? 'An existing go.work was not written by fx' : file.result,
      { resource: file.path, owner: 'user', required: !foreign },
    ),
  ];
}

export function skillChecks(
  output: SkillStageOutput,
  requiredTools: ReadonlySet<string>,
): PreparationCheck[] {
  const own = [...output.links, ...output.fx].map((item) =>
    preparationCheck(
      `skill:${item.path}`,
      item.action === 'foreign' || isUnfinished(item.status) ? 'blocked' : 'ready',
      item.action,
      { resource: item.path, owner: 'user' },
    ),
  );
  const tools = output.tools.map((item) =>
    preparationCheck(
      `skill:${item.tool}`,
      item.failure || item.status === 'failed' || (item.code !== null && item.code !== 0)
        ? 'blocked'
        : 'ready',
      item.note ?? item.status ?? 'No companion Skill declared',
      { resource: item.tool, required: requiredTools.has(item.tool), owner: 'user' },
    ),
  );
  return [...own, ...tools];
}

type PreparationTool = ToolStatus & { preparation_required: boolean };

export function toolChecks(
  rows: readonly PreparationTool[],
  deps: WorkspaceDeps,
): PreparationCheck[] {
  return rows.map((row) =>
    preparationCheck(
      `tool:${row.name}`,
      toolState(row),
      `${row.name}: ${row.state}${row.min_version ? ` (requires ${row.min_version})` : ''}`,
      {
        resource: row.name,
        required: row.preparation_required,
        owner: row.state === 'disabled' ? 'maintainer' : 'user',
        ...(row.failure ? { code: row.failure.code, failure: row.failure } : {}),
        actions: toolRecovery(deps, row),
      },
    ),
  );
}

function toolState(row: PreparationTool): PreparationCheck['state'] {
  if (row.state === 'ok') return 'ready';
  if (row.state === 'disabled' && !row.preparation_required) return 'skipped';
  if (row.state === 'unknown') return 'unknown';
  return 'blocked';
}
