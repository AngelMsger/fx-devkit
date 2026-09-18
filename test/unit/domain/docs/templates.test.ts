import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { providerCatalog } from '../../../../src/composition/registry.js';
import { renderAll, REGIONS } from '../../../../src/domain/docs/templates.js';
import {
  loadEnvironments,
  loadTools,
  loadWorkspace,
} from '../../../../src/domain/manifest/loader.js';
import { bindPlatforms, bindProviders } from '../../../../src/domain/manifest/providers.js';
import { resolveTools } from '../../../../src/domain/toolchain/resolve.js';

const cli = { cliVersion: '1.0.0' };
const bundled = readFileSync(path.resolve('defaults/tools.yaml'), 'utf8');

function render(fixture: string) {
  const read = (name: string): string =>
    readFileSync(path.resolve('test/fixtures/manifest', fixture, name), 'utf8');
  const workspace = loadWorkspace(read('workspace.yaml'), cli).doc;
  const environments = loadEnvironments(read('environments.yaml'), cli, { workspace }).doc;
  const tools = loadTools(bundled, undefined, cli);
  return {
    environments,
    regions: renderAll({
      workspace,
      environments,
      bindings: bindProviders(workspace, providerCatalog()),
      platforms: bindPlatforms(environments, providerCatalog()),
      tools: resolveTools(tools.doc, tools.provenance),
      toolsOf: (provider) => [provider],
    }),
  };
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const SEMVER = /\b\d+\.\d+\.\d+\b/;

describe.each(['v2-full', 'v1-real-shape'])('templates on %s', (fixture) => {
  it('render every region and restate no coordinate, address or version', () => {
    const { environments, regions } = render(fixture);
    expect(Object.keys(regions)).toEqual([...REGIONS]);
    const values = [
      ...Object.values(environments.platforms).flatMap((p) => Object.values(p.vars ?? {})),
      ...Object.values(environments.envs).flatMap((e) =>
        Object.values(e.platforms ?? {}).flatMap((p) => Object.values(p.vars ?? {})),
      ),
    ];
    // A value as short as an org slug appears in ordinary prose; only real coordinates are checked.
    const names = new Set(Object.keys(environments.envs));
    const coordinates = values.filter((v) => v.length >= 4 && !names.has(v));
    for (const [name, text] of Object.entries(regions)) {
      expect(text, name).not.toMatch(EMAIL);
      expect(text, name).not.toMatch(SEMVER);
      for (const value of coordinates)
        expect(text, `${name} restates ${value}`).not.toContain(value);
    }
    expect(regions['project-index']).toContain('`fx-example-api`');
    expect(regions.capabilities).toContain('fx can');
    expect(regions.environments).toContain('fx where');
    expect(regions).not.toHaveProperty('rules');
    expect(regions['ask-fx']).toContain('LOGIN_REQUIRED');
  });
});
