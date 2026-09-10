import { describe, expect, it } from 'vitest';

import { derive, isDerived, marker } from '../../../../src/domain/docs/derived.js';
import { agentsSkeleton } from '../../../../src/domain/docs/skeleton.js';

describe('derived documents', () => {
  it('announce their origin on the first line and nothing else changes', () => {
    const text = derive('# Mine\n\nprose\n', '/home/.fx/workspaces/fx/source/AGENTS.md');
    expect(text.split('\n')[0]).toBe(marker('/home/.fx/workspaces/fx/source/AGENTS.md'));
    expect(text.split('\n').slice(1).join('\n')).toBe('# Mine\n\nprose\n');
    expect(text.split('\n')[0]).toContain('/home/.fx/workspaces/fx/source/AGENTS.md');
    expect(isDerived(text)).toBe(true);
  });

  it('are told apart from anything a person wrote', () => {
    expect(isDerived(agentsSkeleton('fx'))).toBe(false);
    expect(isDerived('# Mine\n')).toBe(false);
    expect(isDerived('')).toBe(false);
  });
});
