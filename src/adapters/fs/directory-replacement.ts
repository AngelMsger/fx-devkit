// Directory replacement records its private staging paths before moving the
// live directory. Recovery keeps the installed tree, or restores the previous
// tree when interruption happened between the two renames.

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';

interface Transaction {
  readonly target: string;
  readonly staged: string;
  readonly backup: string;
}

export async function replaceDirectory(source: string, target: string): Promise<void> {
  const journal = `${target}.fx-transaction`;
  await recover(target, journal);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const token = randomUUID();
  const tx: Transaction = {
    target,
    staged: `${target}.fx-next-${token}`,
    backup: `${target}.fx-old-${token}`,
  };
  await fs.writeFile(journal, JSON.stringify(tx), { flag: 'wx', mode: 0o600 });
  try {
    await fs.cp(source, tx.staged, { recursive: true, errorOnExist: true, force: false });
    if (await exists(target)) await fs.rename(target, tx.backup);
    await fs.rename(tx.staged, target);
    await fs.rm(tx.backup, { recursive: true, force: true });
    await fs.unlink(journal);
  } catch (err) {
    await recover(target, journal);
    throw err;
  }
}

async function recover(target: string, journal: string): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(journal, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  let tx: Transaction;
  try {
    tx = JSON.parse(raw) as Transaction;
  } catch {
    throw conflict();
  }
  if (
    tx?.target !== target ||
    typeof tx.staged !== 'string' ||
    typeof tx.backup !== 'string' ||
    !tx.staged.startsWith(`${target}.fx-next-`) ||
    !tx.backup.startsWith(`${target}.fx-old-`) ||
    path.dirname(tx.staged) !== path.dirname(target) ||
    path.dirname(tx.backup) !== path.dirname(target)
  )
    throw conflict();
  if (!(await exists(target)) && (await exists(tx.backup))) await fs.rename(tx.backup, target);
  await fs.rm(tx.staged, { recursive: true, force: true });
  await fs.rm(tx.backup, { recursive: true, force: true });
  await fs.unlink(journal);
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.lstat(file);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

function conflict(): DevkitError {
  return new DevkitError(
    'conflict',
    'PROJECTION_RECOVERY_REQUIRED',
    'A directory projection has an unrecognized recovery record',
    {
      hint: 'Inspect the transaction and preserve both directories before retrying.',
      nextSteps: ['fx doctor'],
    },
  );
}
