import { describe, expect, it } from 'vitest';

import { renderRegions } from '../../../../src/domain/docs/regions.js';
import { agentsSkeleton } from '../../../../src/domain/docs/skeleton.js';
import { REGIONS } from '../../../../src/domain/docs/templates.js';

const doc = [
  '# Notes',
  '',
  'People wrote this.',
  '',
  '<!-- fx:begin a -->',
  'old a',
  '<!-- fx:end a -->',
  '',
  'More prose, with a   weird   spacing kept.',
  '',
  '<!-- fx:begin legacy -->',
  'someone else generated this',
  '<!-- fx:end legacy -->',
  '',
].join('\n');

describe('renderRegions', () => {
  it('removes retired rules blocks, reports them as unknown, and preserves custom blocks and prose', () => {
    const retired = '<!-- fx:begin rules -->\nold generated rules\n<!-- fx:end rules -->';
    const input = `${retired}\n${doc}\n${retired}\n`;
    const once = renderRegions(input, { a: 'new a' });
    expect(once.text).toBe(`\n${doc.replace('old a', 'new a')}\n\n`);
    expect(once.unknown).toContain('rules');
    expect(once.unknown).toContain('legacy');
    expect(once.replaced).toEqual(['a']);
    const again = renderRegions(once.text, { a: 'new a' });
    expect(again.text).toBe(once.text);
    expect(again.unknown).toEqual(['legacy']);
  });

  it.each([
    '<!-- fx:begin rules -->\nunterminated\n',
    '<!-- fx:begin custom -->\n<!-- fx:begin rules -->\ninner\n<!-- fx:end rules -->\n<!-- fx:end custom -->',
    '<!-- fx:begin rules -->\n<!-- fx:begin custom -->\ninner\n<!-- fx:end custom -->\n<!-- fx:end rules -->',
  ])(
    'preserves malformed or nested retired markers rather than deleting unrelated text',
    (input) => {
      expect(renderRegions(input, {}).text).toBe(input);
    },
  );

  it('replaces only what lies between the markers and reports what is missing or unknown', () => {
    const out = renderRegions(doc, { a: 'new a\nline two', b: 'new b' });
    expect(out.text).toBe(doc.replace('old a', 'new a\nline two'));
    expect(out.replaced).toEqual(['a']);
    expect(out.missing).toEqual(['b']);
    expect(out.unknown).toEqual(['legacy']);
  });

  it('is idempotent', () => {
    const once = renderRegions(doc, { a: 'x' }).text;
    expect(renderRegions(once, { a: 'x' }).text).toBe(once);
  });

  it('starts a new document with every region present and empty', () => {
    expect(REGIONS).not.toContain('rules');
    expect(agentsSkeleton('fx')).not.toContain('fx:begin rules');
    const out = renderRegions(
      agentsSkeleton('fx'),
      Object.fromEntries(REGIONS.map((r) => [r, `## ${r}`])),
    );
    expect(out.missing).toEqual([]);
    expect(out.unknown).toEqual([]);
    expect(out.replaced).toEqual([...REGIONS]);
    expect(out.text.startsWith('# fx workspace')).toBe(true);
  });
});
