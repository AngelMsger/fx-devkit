import { describe, expect, it } from 'vitest';

import { bundledToolsText } from '../../src/composition/bundled.js';
import { loadTools } from '../../src/domain/manifest/loader.js';

describe('bundled defaults/tools.yaml', () => {
  it('loads with no problems and gives every tool an install method', () => {
    const result = loadTools(bundledToolsText(), undefined, { cliVersion: '0.0.0' });
    expect(result.problems).toEqual([]);
    expect(result.dropped).toEqual([]);
    expect(result.unknown).toEqual([]);
    for (const tool of result.doc.tools) {
      expect((tool.install ?? result.doc.defaults?.install ?? []).length).toBeGreaterThan(0);
    }
  });

  it('does not make a bundled companion required for every workspace', () => {
    const result = loadTools(bundledToolsText(), undefined, { cliVersion: '0.0.0' });
    expect(result.doc.tools.filter((t) => t.required).map((t) => t.name)).toEqual([]);
  });
});
