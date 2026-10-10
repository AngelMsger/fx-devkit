// Reject module cycles, including type-only and literal dynamic imports that
// preserve circular ownership. Parse syntax so comments and strings are not edges.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const src = path.resolve(fileURLToPath(import.meta.url), '../../../src');

function modules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return modules(full);
    return /\.(ts|js)$/.test(entry.name) ? [full] : [];
  });
}

function relativeImports(file: string, text: string): string[] {
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    const specifier = moduleSpecifier(node);
    if (specifier && ts.isStringLiteralLike(specifier)) specifiers.push(specifier.text);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest));
  return specifiers
    .filter((specifier) => specifier.startsWith('.'))
    .map((specifier) => path.resolve(path.dirname(file), specifier.replace(/\.js$/, '.ts')));
}

function moduleSpecifier(node: ts.Node): ts.Node | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
    return node.arguments[0];
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
    return node.argument.literal;
  return undefined;
}

function graph(sources: ReadonlyMap<string, string>): Map<string, string[]> {
  const edges = new Map<string, string[]>();
  for (const [file, text] of sources) {
    const targets = relativeImports(file, text).flatMap((target) => {
      if (sources.has(target)) return [target];
      const js = target.replace(/\.ts$/, '.js');
      return sources.has(js) ? [js] : [];
    });
    edges.set(file, targets);
  }
  return edges;
}

function firstCycle(edges: Map<string, string[]>): readonly string[] | undefined {
  const done = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const walk = (file: string): readonly string[] | undefined => {
    if (onStack.has(file)) return [...stack.slice(stack.indexOf(file)), file];
    if (done.has(file)) return undefined;
    stack.push(file);
    onStack.add(file);
    for (const next of edges.get(file) ?? []) {
      const found = walk(next);
      if (found) return found;
    }
    stack.pop();
    onStack.delete(file);
    done.add(file);
    return undefined;
  };
  for (const file of edges.keys()) {
    const found = walk(file);
    if (found) return found;
  }
  return undefined;
}

describe('module cycles', () => {
  it.each([
    ['named imports', 'import { value } from "./b.js";'],
    ['side-effect imports', "import './b.js';"],
    ['re-exports', "export * from './b.js';"],
    ['type-only imports', "import type { Value } from './b.js';"],
    ['dynamic imports', "async function load() { return import('./b.js'); }"],
    ['literal template imports', 'async function load() { return import(`./b.js`); }'],
    ['import type expressions', "type Value = import('./b.js').Value;"],
  ])('detects a cycle through %s', (_kind, source) => {
    const sources = new Map([
      [path.resolve('a.ts'), source],
      [path.resolve('b.ts'), "export type { Value } from './a.js';"],
    ]);
    expect(firstCycle(graph(sources))?.map((file) => path.basename(file))).toEqual([
      'a.ts',
      'b.ts',
      'a.ts',
    ]);
  });

  it('accepts shared dependencies without treating comments, strings or packages as edges', () => {
    const sources = new Map([
      [path.resolve('a.ts'), "import './b.js'; import './shared.js';"],
      [path.resolve('b.ts'), "export * from './shared.js';"],
      [
        path.resolve('shared.js'),
        [
          "/*\nimport { value } from './a.js';\n*/",
          "const example = `\nexport * from './a.js';\n`;",
          "import ts from 'typescript';",
          "export const load = () => import('node:fs');",
        ].join('\n'),
      ],
    ]);
    expect(firstCycle(graph(sources))).toBeUndefined();
  });

  it('finds no import cycle anywhere in src', () => {
    const sources = new Map(modules(src).map((file) => [file, readFileSync(file, 'utf8')]));
    const cycle = firstCycle(graph(sources));
    expect(cycle?.map((file) => path.relative(src, file))).toBeUndefined();
  });
});
