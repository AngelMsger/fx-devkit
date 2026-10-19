// Real file-store checks cover lost updates and ancestor links outside a registered workspace.
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, it } from 'vitest';

import { SetRepoField } from '../../../../src/application/manifest/set.js';
import { providerCatalog } from '../../../../src/composition/registry.js';
import { FileLock } from '../../../../src/infra/lock.js';
import { FileProjectionStore } from '../../../../src/infra/projection-store.js';
import { tempDir } from '../../../temp.js';

const original = 'schema_version: 2\nrepos:\n  - name: app\n    desc: Original\n';
async function fixture() {
  const root = tempDir('fx-edit-conflict-');
  await mkdir(path.join(root, 'manifest'));
  const file = path.join(root, 'manifest/workspace.yaml');
  await writeFile(file, original);
  const files = new FileProjectionStore(new FileLock(path.join(root, 'state')));
  const input = {
    dir: root,
    cliVersion: '1.0.0',
    providers: providerCatalog(),
    repo: 'app',
    field: 'branch',
    value: 'release',
    dryRun: false,
    posture: { readOnly: false, source: 'default' as const },
  };
  return { root, file, files, input };
}
it('preserves an edit made after planning instead of overwriting it', async () => {
  const { file, files, input } = await fixture();
  const concurrent = original.replace('Original', 'Concurrent user edit');
  const editor = new SetRepoField({
    read: (at) => files.read(at),
    async write(request) {
      await writeFile(file, concurrent);
      return files.write(request);
    },
  });
  await expect(editor.execute(input)).rejects.toMatchObject({ code: 'MANIFEST_EDIT_CONFLICT' });
  expect(await readFile(file, 'utf8')).toBe(concurrent);
  await expect(new SetRepoField(files).execute(input)).resolves.toMatchObject({ written: true });
  expect(await readFile(file, 'utf8')).toContain('Concurrent user edit');
  expect(await readFile(file, 'utf8')).toContain('release');
  await expect(new SetRepoField(files).execute(input)).resolves.toMatchObject({ written: false });
});
it('does not follow a linked manifest directory into another tree', async () => {
  const { root, file, files, input } = await fixture();
  const elsewhere = path.join(root, 'elsewhere');
  await mkdir(elsewhere);
  await writeFile(path.join(elsewhere, 'workspace.yaml'), original);
  await rm(path.join(root, 'manifest'), { recursive: true });
  await symlink(
    elsewhere,
    path.join(root, 'manifest'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await expect(new SetRepoField(files).execute(input)).rejects.toMatchObject({
    code: 'MANIFEST_EDIT_CONFLICT',
  });
  expect(await readFile(file, 'utf8')).toBe(original);
});
