// Every exposed setting must remain available in personal storage and exported
// profiles; otherwise a saved or transferred preference silently disappears.

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ConfigExport } from '../../src/application/config/export.js';
import { ConfigImport } from '../../src/application/config/import.js';
import { KEYS, type Key } from '../../src/application/config/keys.js';
import { SetConfig } from '../../src/application/config/set.js';
import { spellValue } from '../../src/application/config/values.js';
import { providerCatalog } from '../../src/composition/registry.js';
import { FileConfigStore } from '../../src/infra/config-store.js';
import { FakeClock } from '../fakes/fake-clock.js';
import { FakeFs } from '../fakes/fake-fs.js';
import { FakeLocalStore } from '../fakes/fake-local-store.js';
import { FakeLock } from '../fakes/fake-lock.js';
import { tempDir } from '../temp.js';

const write = { dryRun: false, posture: { readOnly: false, source: 'default' as const } };
const root = path.resolve('/workspaces/sample');

// Never the default, so a setting that was dropped cannot read back as its own value.
function sample(key: Key): string {
  switch (key.kind) {
    case 'enum':
      return key.options?.find((option) => option !== key.default) ?? '';
    case 'bool':
      return key.default === 'true' ? 'false' : 'true';
    case 'list':
      return 'codex,claude-code';
    case 'string':
      return 'sample';
  }
}

describe('config contract', () => {
  it.each(KEYS.map((key) => [key.name, key] as const))(
    'keeps %s through the personal file and an exported profile',
    async (_name, key) => {
      const saved = new FileConfigStore(tempDir('fx-config-saved-'), new FakeLock());
      await saved.write({ workspaces: { sample: { root } } });
      await new SetConfig(saved).execute({ key: key.name, value: sample(key), ...write });
      const stored = (await saved.read())[key.name];
      expect(spellValue(stored)).toBe(sample(key));

      const machine = { localStore: new FakeLocalStore(), fs: FakeFs.from({}) };
      const profile = await new ConfigExport({
        ...machine,
        config: saved,
        clock: new FakeClock(),
      }).execute();
      const carried = new FileConfigStore(tempDir('fx-config-carried-'), new FakeLock());
      await new ConfigImport({
        ...machine,
        config: carried,
        manifestDirFor: (name) => path.resolve('/fake/.fx/workspaces', name, 'source'),
        lock: new FakeLock(),
        cliVersion: '1.0.0',
        providers: providerCatalog(),
      }).execute({ text: profile.text, ...write });
      expect((await carried.read())[key.name]).toEqual(stored);
    },
  );
});
