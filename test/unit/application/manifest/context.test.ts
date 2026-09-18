import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadManifestContext } from '../../../../src/application/manifest/context.js';
import { providerCatalog } from '../../../../src/composition/registry.js';
import type { DiagnosticEvent } from '../../../../src/ports/diagnostics.js';
import { FakeFs } from '../../../fakes/fake-fs.js';
import { FakeReporter } from '../../../fakes/fake-reporter.js';

const fixture = (name: string): string =>
  readFileSync(path.resolve('test/fixtures/manifest', name), 'utf8');
const bundled = (): string => readFileSync(path.resolve('defaults/tools.yaml'), 'utf8');

function load(dir: string, doc: string) {
  const reporter = new FakeReporter();
  return loadManifestContext({
    dir,
    fs: FakeFs.from({ [`${dir}/manifest/workspace.yaml`]: fixture(doc) }),
    bundledTools: bundled,
    providers: providerCatalog(),
    cliVersion: '1.0.0',
    reporter,
  }).then((context) => ({ context, reporter }));
}

describe('loadManifestContext', () => {
  it('loads the documents of a directory and binds the providers they name', async () => {
    const { context, reporter } = await load(path.resolve('/co'), 'v1-minimal/workspace.yaml');
    expect(context.dir).toBe(path.resolve('/co'));
    expect(context.bundle.dir).toBe(path.resolve('/co'));
    expect(context.bundle.workspace.result.doc.repos.map((r) => r.name)).toEqual([
      'fx-example-api',
      'fx-example-auth',
      'fx-example-docs',
    ]);
    expect(context.bindings.find((b) => b.capability === 'code-host')).toMatchObject({
      provider: 'bitbucket-cli',
    });
    expect(reporter.codes()).toEqual([]);
  });

  it('loads optional harness resources and reports their quarantined siblings', async () => {
    const reporter = new FakeReporter();
    const context = await loadManifestContext({
      dir: path.resolve('/co'),
      fs: FakeFs.from({
        [path.resolve('/co/manifest/workspace.yaml')]: fixture('v1-minimal/workspace.yaml'),
        [path.resolve('/co/manifest/harness.yaml')]: JSON.stringify({
          schema_version: 2,
          mcp: [
            { name: 'knowledge', transport: 'stdio', command: ['server'] },
            { name: 'broken', transport: 'stdio' },
          ],
        }),
      }),
      bundledTools: bundled,
      providers: providerCatalog(),
      cliVersion: '1.0.0',
      reporter,
    });
    expect(context.bundle.harness?.result.doc.mcp.map((item) => item.name)).toEqual(['knowledge']);
    expect(reporter.notices).toContainEqual(
      expect.objectContaining({ code: 'MANIFEST_ENTRY_UNUSABLE', data: { dropped: ['broken'] } }),
    );
  });

  it('reports quarantined entries on every load', async () => {
    const { reporter } = await load(path.resolve('/co'), 'broken/entry.yaml');
    expect(reporter.notices).toEqual([
      expect.objectContaining({
        code: 'MANIFEST_ENTRY_UNUSABLE',
        data: { dropped: ['repos[1]', 'escapes'] },
      }),
    ]);
  });

  it('connects a rejected field to the manifest file and source line', async () => {
    const events: DiagnosticEvent[] = [];
    await expect(
      loadManifestContext({
        dir: path.resolve('/co'),
        fs: FakeFs.from({
          [path.resolve('/co/manifest/workspace.yaml')]:
            'schema_version: 1\ndefaults: {host: ssh://git@git.example.com}\nrepos: nope\n',
        }),
        bundledTools: bundled,
        providers: providerCatalog(),
        cliVersion: '1.0.0',
        reporter: new FakeReporter(),
        diagnostics: { emit: (event) => events.push(event) },
      }),
    ).rejects.toMatchObject({ code: 'MANIFEST_INVALID' });
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'manifest',
        file: path.resolve('/co/manifest/workspace.yaml'),
        field: 'repos',
        line: 3,
      }),
    ]);
  });
});
