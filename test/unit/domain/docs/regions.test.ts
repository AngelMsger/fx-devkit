import { describe, expect, it } from 'vitest';

import { completeRegions, renderRegions } from '../../../../src/domain/docs/regions.js';
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
  it('completes a generated guide without changing author prose and refuses ambiguous boundaries', () => {
    const completed = completeRegions(doc, { a: 'new a', b: 'new b' });
    expect(completed.text).toContain(doc.replace('old a', 'new a'));
    expect(completed.added).toEqual(['b']);
    expect(completed.missing).toEqual([]);
    expect(completeRegions(completed.text, { a: 'new a', b: 'new b' }).text).toBe(completed.text);
    for (const malformed of [
      '<!-- fx:begin a -->',
      '<!-- fx:begin a --><!-- fx:begin b --><!-- fx:end b --><!-- fx:end a -->',
      '<!-- fx:begin a --><!-- fx:end a --><!-- fx:begin a --><!-- fx:end a -->',
    ])
      expect(() => completeRegions(malformed, { a: 'new a' })).toThrow('ambiguous');
  });
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
