// A module cycle makes initialization order decide behavior and hides which
// module owns a fact. Type-only edges count: they are the ones that survive a
// refactor unnoticed. This check needs no exception list — an exception would
// mean the cycle is still there.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const src = path.resolve(fileURLToPath(import.meta.url), '../../../src');

function modules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return modules(full);
    return /\.(ts|js)$/.test(entry.name) ? [full] : [];
  });
}

// Every static import and re-export, whether it carries values or only types.
function relativeImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const specifiers = [...text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?from\s*'([^']+)'/g)];
  return specifiers
    .map((match) => match[1]!)
    .filter((specifier) => specifier.startsWith('.'))
    .map((specifier) => path.resolve(path.dirname(file), specifier.replace(/\.js$/, '.ts')));
}

function graph(): Map<string, string[]> {
  const files = new Set(modules(src));
  const edges = new Map<string, string[]>();
  for (const file of files) {
    const targets = relativeImports(file).flatMap((target) => {
      if (files.has(target)) return [target];
      const js = target.replace(/\.ts$/, '.js');
      return files.has(js) ? [js] : [];
    });
    edges.set(file, targets);
  }
  return edges;
}

// Depth-first search that reports the first cycle it closes, as the chain of
// modules that leads back into itself.
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
  it('finds no import cycle anywhere in src', () => {
    const cycle = firstCycle(graph());
    expect(cycle?.map((file) => path.relative(src, file))).toBeUndefined();
  });
});
