import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import type * as bundledAssets from '../../../src/composition/bundled.js';
import { tempDir } from '../../temp.js';

type Bundled = typeof bundledAssets;

const TOOLS = 'schema_version: 3\ntools: []\n';

// The module finds its assets from where it is installed, so the case installs a copy.
async function installedUnder(root: string): Promise<Bundled> {
  const file = path.join(root, 'dist', 'composition', 'bundled.mjs');
  mkdirSync(path.dirname(file), { recursive: true });
  mkdirSync(path.join(root, 'defaults'));
  writeFileSync(path.join(root, 'defaults', 'tools.yaml'), TOOLS);
  const source = readFileSync(path.resolve('src/composition/bundled.ts'), 'utf8');
  writeFileSync(
    file,
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  );
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Bundled;
}

describe('bundled assets', () => {
  it('names the bundled toolchain by a local path under a directory with a space or a non-ASCII name', async () => {
    const installation = path.join('program files', 'fx 工具');
    const bundled = await installedUnder(path.join(tempDir('fx-bundled-'), installation));
    const tools = bundled.bundledToolsPath();
    expect(tools).toContain(path.join(installation, 'defaults', 'tools.yaml'));
    expect(readFileSync(tools, 'utf8')).toBe(TOOLS);
    expect(bundled.bundledToolsText()).toBe(TOOLS);
  });
});
