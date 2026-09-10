// Exercise the real lint policy with representative forbidden imports so a
// configuration edit cannot silently remove the inner layers' IO boundary.

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
        ['no-restricted-imports', 'no-restricted-syntax'].includes(message.ruleId ?? ''),
      )
      .map((message) => message.ruleId!),
  );
}

describe('inner-layer dependencies', () => {
  it.each(['src/domain/values.ts', 'src/application/can.ts', 'src/ports/fs.ts'])(
    'rejects IO and service packages in %s',
    async (file) => {
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
      expect(await restrictions(file, "await import('node:fs');")).toContain(
        'no-restricted-syntax',
      );
    },
  );

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
