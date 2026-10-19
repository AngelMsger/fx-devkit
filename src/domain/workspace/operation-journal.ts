// The journal of a workspace identity operation: the registry change an
// unregister, relocate or rebind set out to make and the last phase it
// completed. A retried command resumes from that phase, so the phases are
// ordered, and a journal is resumed only when its entries are the change its
// action makes.

import path from 'node:path';

import type { WorkspaceEntry } from '../config/file.js';

export const OPERATION_ACTIONS = ['unregister', 'relocate', 'rebind'] as const;
export type OperationAction = (typeof OPERATION_ACTIONS)[number];

// In the order an operation completes them; only a rebind stages and replaces a source.
export const OPERATION_PHASES = [
  'planned',
  'source_ready',
  'resources_cleaned',
  'source_replaced',
  'registered',
] as const;
export type OperationPhase = (typeof OPERATION_PHASES)[number];

export interface OperationJournal {
  readonly id: string;
  readonly name: string;
  readonly action: OperationAction;
  readonly before: WorkspaceEntry;
  readonly after: WorkspaceEntry | null;
  // The physical workspace root the operation acts on.
  readonly root: string;
  readonly phase: OperationPhase;
}

const ID = /^[a-f0-9-]{36}$/;

export function operationJournalPath(workspaceHome: string): string {
  return path.join(workspaceHome, 'workspace-operation.json');
}

export function hasReached(
  journal: Pick<OperationJournal, 'phase'>,
  phase: OperationPhase,
): boolean {
  return OPERATION_PHASES.indexOf(journal.phase) >= OPERATION_PHASES.indexOf(phase);
}

export function sameEntry(a: WorkspaceEntry | null, b: WorkspaceEntry | null): boolean {
  if (a === null || b === null) return a === b;
  return a.root === b.root && a.source === b.source;
}

export function sameJournal(a: OperationJournal, b: OperationJournal): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.action === b.action &&
    a.root === b.root &&
    a.phase === b.phase &&
    sameEntry(a.before, b.before) &&
    sameEntry(a.after, b.after)
  );
}

// The registry keeps the old entry until resources are cleaned, may hold either
// until the registration checkpoint is written, and holds the new one after it.
export function matchesRegistry(
  journal: OperationJournal,
  observed: WorkspaceEntry | null,
): boolean {
  if (hasReached(journal, 'registered')) return sameEntry(observed, journal.after);
  return (
    sameEntry(observed, journal.before) ||
    (hasReached(journal, 'resources_cleaned') && sameEntry(observed, journal.after))
  );
}

export function serializeJournal(journal: OperationJournal): string {
  const { id, name, action, before, after, root, phase } = journal;
  return JSON.stringify({ id, name, action, before, after, root, phase });
}

// Undefined for anything other than a journal of this workspace that an operation wrote.
export function parseJournal(text: string, name: string): OperationJournal | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const { id, action, before, after, root, phase } = value as Record<string, unknown>;
  if ((value as Record<string, unknown>)['name'] !== name) return undefined;
  if (typeof id !== 'string' || !ID.test(id) || typeof root !== 'string') return undefined;
  if (!isAction(action) || !isPhase(phase)) return undefined;
  if (!isEntry(before) || (after !== null && !isEntry(after))) return undefined;
  const journal = { id, name, action, before, after, root, phase };
  return recordsItsAction(journal) ? journal : undefined;
}

function isAction(value: unknown): value is OperationAction {
  return OPERATION_ACTIONS.some((action) => action === value);
}

function isPhase(value: unknown): value is OperationPhase {
  return OPERATION_PHASES.some((phase) => phase === value);
}

function isEntry(value: unknown): value is WorkspaceEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry['root'] === 'string' &&
    (entry['source'] === undefined || typeof entry['source'] === 'string') &&
    Object.keys(entry).every((key) => key === 'root' || key === 'source')
  );
}

function recordsItsAction(journal: OperationJournal): boolean {
  const { action, before, after, root } = journal;
  if (action === 'unregister') return after === null;
  if (after === null) return false;
  if (action === 'relocate') return after.root === root && after.source === before.source;
  return after.root === before.root && after.source !== undefined;
}
