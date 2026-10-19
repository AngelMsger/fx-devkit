// Exercise the real lint policy with representative forbidden imports so a
// configuration edit cannot silently remove a layer boundary, the inner layers'
// IO boundary, the constructor shape of application classes or the rule that
// keeps tests from selecting calls by position.

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({
  overrideConfig: {
    languageOptions: { parserOptions: { project: false } },
    rules: { '@typescript-eslint/switch-exhaustiveness-check': 'off' },
  },
});

async function restrictions(filePath: string, source: string): Promise<readonly string[]> {
  const results = await eslint.lintText(source, { filePath });
  return results.flatMap((result) =>
    result.messages
      .filter((message) =>
        ['no-restricted-imports', 'no-restricted-syntax', 'import-x/no-restricted-paths'].includes(
          message.ruleId ?? '',
        ),
      )
      .map((message) => message.ruleId!),
  );
}

describe('inner-layer dependencies', () => {
  it.each([
    'src/domain/values.ts',
    'src/domain/distribution.js',
    'src/application/readiness/can.ts',
    'src/ports/fs.ts',
  ])('rejects IO and service packages in %s', async (file) => {
    for (const module of [
      'node:fs',
      'fs/promises',
      'node:child_process',
      'node:http',
      '@vendor/client',
    ])
      expect(await restrictions(file, `import value from '${module}';`)).toContain(
        'no-restricted-imports',
      );
    expect(await restrictions(file, "await import('node:fs');")).toContain('no-restricted-syntax');
  });

  it('confines schema and serialization dependencies to configuration codecs', async () => {
    for (const module of ['yaml', 'zod']) {
      expect(
        await restrictions('src/application/config/import.ts', `import value from '${module}';`),
      ).toContain('no-restricted-imports');
      expect(
        await restrictions('src/domain/config/codec.ts', `import value from '${module}';`),
      ).toEqual([]);
      expect(
        await restrictions('src/domain/manifest/loader.ts', `import value from '${module}';`),
      ).toEqual([]);
    }
    expect(await restrictions('src/domain/import/render.ts', "import value from 'yaml';")).toEqual(
      [],
    );
    expect(
      await restrictions('src/domain/config/codec.ts', "import value from 'node:fs';"),
    ).toContain('no-restricted-imports');
  });

  it('permits pure path/hash helpers and relative domain imports', async () => {
    for (const module of ['node:path', 'node:path/posix', 'node:crypto', './errors.js'])
      expect(await restrictions('src/domain/values.ts', `import value from '${module}';`)).toEqual(
        [],
      );
  });
});

describe('layer dependencies', () => {
  it.each([
    { layer: 'domain', file: 'src/domain/values.ts', outer: '../ports/fs.js' },
    { layer: 'ports', file: 'src/ports/fs.ts', outer: '../application/readiness/can.js' },
    {
      layer: 'application',
      file: 'src/application/readiness/can.ts',
      outer: '../../adapters/fs/node-fs.js',
    },
    { layer: 'adapters', file: 'src/adapters/fs/node-fs.ts', outer: '../../infra/lock.js' },
    { layer: 'infra', file: 'src/infra/lock.ts', outer: '../adapters/fs/node-fs.js' },
    { layer: 'cli', file: 'src/cli/main.ts', outer: '../infra/lock.js' },
  ])('rejects an import from $layer into a layer it may not see', async ({ file, outer }) => {
    expect(await restrictions(file, `import value from '${outer}';`)).toEqual([
      'import-x/no-restricted-paths',
    ]);
  });

  it('permits an import towards the inner layers, and composition from the command line', async () => {
    expect(
      await restrictions(
        'src/application/readiness/can.ts',
        "import value from '../../ports/fs.js';",
      ),
    ).toEqual([]);
    expect(
      await restrictions('src/cli/main.ts', "import value from '../composition/container.js';"),
    ).toEqual([]);
  });
});

describe('application constructors', () => {
  const classTaking = (parameters: string): string =>
    `export class Sample { constructor(${parameters}) {} }`;
  const positional = 'private readonly fs: Fs, private readonly git: Git, readonly lock: Lock';

  it('rejects a third constructor parameter', async () => {
    expect(await restrictions('src/application/sample.ts', classTaking(positional))).toEqual([
      'no-restricted-syntax',
    ]);
  });

  it('permits two dependency bundles', async () => {
    expect(
      await restrictions(
        'src/application/sample.ts',
        classTaking('private readonly deps: Deps, private readonly login: LoginDeps'),
      ),
    ).toEqual([]);
  });

  it('leaves the other layers their own constructor shapes', async () => {
    for (const file of ['src/domain/sample.ts', 'src/adapters/sample.ts', 'src/infra/sample.ts'])
      expect(await restrictions(file, classTaking(positional))).toEqual([]);
  });
});

describe('recorded calls in tests', () => {
  it('rejects selecting a recorded call by its position', async () => {
    for (const source of ['const first = fake.calls[0];', 'const last = fake.calls.at(-1);'])
      expect(await restrictions('test/unit/sample.test.ts', source)).toEqual([
        'no-restricted-syntax',
      ]);
    expect(
      await restrictions('test/unit/sample.test.ts', "const call = fake.soleCallTo(['git']);"),
    ).toEqual([]);
  });
});
