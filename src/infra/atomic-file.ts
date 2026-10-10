// Replace a file through an exclusive sibling temporary. Stores own serialization,
// parent creation, locking and ownership checks; journals also request durable writes.

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

interface AtomicFileOptions {
  readonly durable?: boolean;
  readonly mode?: number;
}

export async function writeAtomicFile(
  file: string,
  text: string,
  options: AtomicFileOptions = {},
): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, 'wx', options.mode ?? 0o600);
    try {
      await handle.writeFile(text);
      if (options.durable) await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, file);
    if (options.durable && process.platform !== 'win32') await syncDirectory(path.dirname(file));
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await fs.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
