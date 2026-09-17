// Removed manifest entries remain visible through personal installation evidence.

import { asDevkitError } from '../../domain/errors.js';
import type { ToolInstalled } from '../tool/installed.js';

import { finding, type Finding } from './types.js';

export async function checkInstallations(
  inventory: ToolInstalled | undefined,
  names?: readonly string[],
): Promise<Finding[]> {
  let rows;
  try {
    rows = (await inventory?.execute()) ?? [];
  } catch (error) {
    const failure = asDevkitError(error);
    return [
      finding('tools', 'installation-history', 'warn', failure.message, {
        coverage: 'incomplete',
        fix: 'fx tool history',
        evidence: { code: failure.code },
      }),
    ];
  }
  return rows
    .filter(
      (row) =>
        (names === undefined || names.includes(row.name)) &&
        ['unused', 'unknown', 'unverified', 'changed'].includes(row.state),
    )
    .map((row) =>
      finding(
        'tools',
        `installation:${row.via}:${row.spec}`,
        'warn',
        row.uninstall_hint ??
          `${row.name}: installation evidence is ${row.state}; review history before removing the package.`,
        {
          coverage: row.state === 'unused' ? 'checked' : 'incomplete',
          fix: 'fx tool inventory',
          evidence: { installation: row },
        },
      ),
    );
}
