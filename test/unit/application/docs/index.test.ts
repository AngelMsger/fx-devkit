import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DeriveDocs } from '../../../../src/application/docs/derive.js';
import { RenderRegions } from '../../../../src/application/docs/render-regions.js';
import { replacementFor } from '../../../../src/application/safety/replace-files.js';
import { derive, isDerived } from '../../../../src/domain/docs/derived.js';
import { begin, end } from '../../../../src/domain/docs/regions.js';
import { REGIONS } from '../../../../src/domain/docs/templates.js';
import { FakePrompter } from '../../../fakes/fake-prompter.js';
import { MANIFEST_DIR, ROOT, harness } from '../../../fakes/workspace.js';

const fixture = (name: string): string =>
  readFileSync(path.resolve('test/fixtures/manifest/v1-real-shape', name), 'utf8');
const write = {
  check: false,
  dryRun: false,
  posture: { readOnly: false, source: 'default' as const },
};
const ORIGIN = path.join(MANIFEST_DIR, 'AGENTS.md');
const ORIGIN_CLAUDE = path.join(MANIFEST_DIR, 'CLAUDE.md');
const AGENTS = path.join(ROOT, 'AGENTS.md');
const CLAUDE = path.join(ROOT, 'CLAUDE.md');
const describeProvider = () => undefined;

async function stage(files: Record<string, string> = {}) {
  const h = await harness({
    workspace: fixture('workspace.yaml'),
    files: {
      [`${MANIFEST_DIR}/manifest/environments.yaml`]: fixture('environments.yaml'),
      ...files,
    },
  });
  return {
    h,
    regions: new RenderRegions({
      fs: h.fs,
      projections: h.deps.projections,
      reporter: h.reporter,
      context: h.ctx.context,
      describeProvider,
    }),
    derive: new DeriveDocs(h.deps, { describeProvider }),
  };
}

// Derived links to source files use forward slashes on every platform.
const linked = (file: string): string => file.split(path.sep).join('/');

describe('RenderRegions, inside a checkout of the manifest repository', () => {
  it('derives a live Skill catalog with descriptions and readable source links', async () => {
    const skillPath = `${MANIFEST_DIR}/skills/review/SKILL.md`;
    const s = await stage({
      [ORIGIN]: `# Team\n\nHuman routing.\n\n${begin('team-skills')}\nstale\n${end('team-skills')}\n`,
      [skillPath]:
        '---\nname: review\ndescription: >-\n  Review a change | carefully\n  and preserve evidence.\n---\nPrivate body',
    });
    await s.regions.execute(write);
    const source = (await s.h.fs.readText(ORIGIN))!;
    expect(source).toContain('Review a change \\| carefully and preserve evidence.');
    expect(source).toContain('[SKILL.md](<skills/review/SKILL.md>)');
    expect(source).not.toContain('Private body');
    await s.derive.execute(write);
    const derived = (await s.h.fs.readText(AGENTS))!;
    expect(derived).toContain(`[SKILL.md](<${linked(skillPath)}>)`);
    expect(derived).toContain('Human routing.');
    expect((await s.derive.execute(write)).files.every((f) => f.action === 'unchanged')).toBe(true);
    await s.h.fs.remove(skillPath);
    await s.derive.execute(write);
    expect(await s.h.fs.readText(AGENTS)).toContain('contains no team Skills');
    await s.h.fs.writeText(skillPath, '---\nname: review\n---\n');
    await s.derive.execute(write);
    expect(await s.h.fs.readText(AGENTS)).toContain('No description provided');
  });

  it('resolves existing source document links while leaving business and external references intact', async () => {
    const s = await stage({
      [ORIGIN]:
        '[guide](docs/guide.md#entry) [repo](../service/README.md) [web](https://example.com)',
      [`${MANIFEST_DIR}/docs/guide.md`]: '# entry',
    });
    await s.derive.execute(write);
    const result = await s.h.fs.readText(AGENTS);
    expect(result).toContain(`](<${linked(MANIFEST_DIR)}/docs/guide.md#entry>)`);
    expect(result).toContain('[repo](../service/README.md) [web](https://example.com)');
  });
  it('creates the document from the skeleton, then leaves it alone', async () => {
    const s = await stage();
    const first = await s.regions.execute(write);
    expect(first.files.map((f) => [f.path, f.action])).toEqual([[ORIGIN, 'created']]);
    expect(first.files[0]?.missing).toEqual([]);
    expect(s.h.reporter.notices.map((n) => n.code)).toEqual(['DOCS_CREATED']);
    const text = await s.h.fs.readText(ORIGIN);
    expect(text).toContain('| `fx-example-api` |');
    expect(isDerived(text ?? '')).toBe(false);
    const again = await s.regions.execute(write);
    expect(again.files.map((f) => f.action)).toEqual(['unchanged']);
    expect(await s.regions.execute({ ...write, check: true })).toBeDefined();
  });

  it('only touches regions of an existing document, reports the missing ones, and never inserts', async () => {
    const prose = `# Mine\n\nRouting rules people wrote.\n\n${begin('rules')}\nstale\n${end('rules')}\n`;
    const s = await stage({ [ORIGIN]: prose, [ORIGIN_CLAUDE]: 'keep' });
    const out = await s.regions.execute(write);
    expect(out.files[0]).toMatchObject({
      action: 'updated',
      replaced: [],
      unknown: ['rules'],
      missing: [
        'project-index',
        'capabilities',
        'environments',
        'ask-fx',
        'workspace-layout',
        'team-skills',
      ],
    });
    expect(out.files).toHaveLength(1);
    const text = (await s.h.fs.readText(ORIGIN)) ?? '';
    expect(text.startsWith('# Mine\n\nRouting rules people wrote.\n\n')).toBe(true);
    expect(text).not.toContain('stale');
    expect(text).not.toContain('fx:begin rules');
    expect(s.h.reporter.codes()).toContain('DOCS_REGION_UNKNOWN');
    expect(text).not.toContain('fx:begin project-index');
    expect(await s.h.fs.readText(ORIGIN_CLAUDE)).toBe('keep');
    expect(s.h.reporter.notices.filter((n) => n.code === 'DOCS_REGION_MISSING')).toHaveLength(
      REGIONS.length,
    );
  });

  it('objects under --check when stale, writes nothing under --dry-run or --out', async () => {
    const s = await stage({ [ORIGIN]: `${begin('rules')}\nold\n${end('rules')}\n` });
    await expect(s.regions.execute({ ...write, check: true })).rejects.toMatchObject({
      code: 'DOCS_STALE',
      category: 'conflict',
    });
    await s.regions.execute({ ...write, dryRun: true });
    expect(await s.h.fs.readText(ORIGIN)).toContain('old');
    const draft = await s.regions.execute({ ...write, out: path.resolve('/tmp/draft.md') });
    expect(draft.files.map((f) => [f.path, f.action])).toEqual([
      [path.resolve('/tmp/draft.md'), 'created'],
    ]);
    expect(await s.h.fs.readText(ORIGIN)).toContain('old');
    expect(await s.h.fs.readText(path.resolve('/tmp/draft.md'))).not.toContain('fx:begin rules');
    expect(draft.files[0]?.missing, 'a draft is the fully rendered skeleton').toEqual([]);
    await expect(
      s.regions.execute({ ...write, posture: { readOnly: true, source: 'env' } }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
  });
});

describe('DeriveDocs, in the workspace root', () => {
  const prose = `# Ours\n\nRouting rules people wrote.\n\n${begin('rules')}\nstale\n${end('rules')}\n`;

  it('derives AGENTS.md from the source prose with fresh regions, and nothing beside it', async () => {
    const s = await stage({ [ORIGIN]: prose });
    const out = await s.derive.execute(write);
    expect(out.files.map((f) => [f.path, f.action])).toEqual([[AGENTS, 'created']]);
    const agents = (await s.h.fs.readText(AGENTS)) ?? '';
    expect(isDerived(agents)).toBe(true);
    expect(agents.split('\n')[0]).toContain(ORIGIN);
    expect(agents).toContain('Routing rules people wrote.');
    expect(agents).not.toContain('fx:begin rules');
    expect(agents).not.toContain('stale');
    expect(await s.h.fs.exists(ORIGIN)).toBe(true);
    expect(s.h.fs.writes).toEqual([AGENTS]);
    expect(out.files[0]?.added).toHaveLength(REGIONS.length);
    expect(await s.h.fs.readText(ORIGIN)).toBe(prose);
    const again = await s.derive.execute(write);
    expect(again.files.map((f) => f.action)).toEqual(['unchanged']);
    expect(await s.derive.execute({ ...write, check: true })).toBeDefined();
  });

  it('removes the pointer an earlier version derived beside the guide', async () => {
    const pointer = derive('# CLAUDE.md\n', ORIGIN);
    const s = await stage({ [ORIGIN]: prose, [CLAUDE]: pointer });
    await expect(s.derive.execute({ ...write, check: true })).rejects.toMatchObject({
      code: 'DOCS_STALE',
    });
    await s.derive.execute({ ...write, dryRun: true });
    expect(await s.h.fs.readText(CLAUDE)).toBe(pointer);
    const out = await s.derive.execute(write);
    expect(out.files.map((f) => [f.path, f.action, f.result])).toEqual([
      [AGENTS, 'created', 'done'],
      [CLAUDE, 'removed', 'done'],
    ]);
    expect(await s.h.fs.exists(CLAUDE)).toBe(false);
    expect(s.h.reporter.codes().filter((code) => code === 'DOCS_POINTER_REMOVED')).toHaveLength(1);
    expect((await s.derive.execute(write)).files.map((f) => f.path)).toEqual([AGENTS]);
  });

  it('backs up user documents only after approval, and never prompts during a preview', async () => {
    const s = await stage({ [AGENTS]: 'Personal rules' });
    const prompter = new FakePrompter();
    const replace = replacementFor(s.h.fs, prompter, s.h.reporter, false);
    await s.derive.execute({ ...write, dryRun: true, replace });
    expect(prompter.questions).toEqual([]);
    prompter.confirmWith = false;
    await s.derive.execute({ ...write, replace });
    expect(await s.h.fs.readText(AGENTS)).toBe('Personal rules');
    prompter.confirmWith = true;
    await s.derive.execute({ ...write, replace });
    expect(await s.h.fs.readText(`${AGENTS}.fx-backup`)).toBe('Personal rules');
    expect(isDerived((await s.h.fs.readText(AGENTS))!)).toBe(true);
  });

  it('starts from the skeleton when the source has no AGENTS.md', async () => {
    const s = await stage();
    await s.derive.execute(write);
    const agents = (await s.h.fs.readText(AGENTS)) ?? '';
    expect(isDerived(agents)).toBe(true);
    expect(agents).toContain('# fx workspace');
    expect(agents).toContain('| `fx-example-api` |');
  });

  it('never replaces a file a person wrote, and does not call it stale', async () => {
    const s = await stage({ [ORIGIN]: prose, [AGENTS]: '# Mine\n', [CLAUDE]: 'keep' });
    const out = await s.derive.execute(write);
    expect(out.files.map((f) => [f.path, f.action])).toEqual([[AGENTS, 'foreign']]);
    expect(await s.h.fs.readText(AGENTS)).toBe('# Mine\n');
    expect(await s.h.fs.readText(CLAUDE)).toBe('keep');
    expect(s.h.reporter.codes()).toContain('DOCS_FOREIGN');
    expect(await s.derive.execute({ ...write, check: true })).toBeDefined();
  });

  it('objects under --check when a derived file is stale; --dry-run writes nothing and --out leaves the root alone', async () => {
    const s = await stage({ [ORIGIN]: prose, [AGENTS]: derive('# old\n', ORIGIN) });
    await expect(s.derive.execute({ ...write, check: true })).rejects.toMatchObject({
      code: 'DOCS_STALE',
    });
    await s.derive.execute({ ...write, dryRun: true });
    expect(await s.h.fs.readText(AGENTS)).toBe(derive('# old\n', ORIGIN));
    const draft = await s.derive.execute({ ...write, out: path.resolve('/tmp/draft.md') });
    expect(draft.files.map((f) => [f.path, f.action])).toEqual([
      [path.resolve('/tmp/draft.md'), 'created'],
    ]);
    expect(await s.h.fs.readText(path.resolve('/tmp/draft.md'))).toContain(
      'Routing rules people wrote.',
    );
    expect(
      (await s.derive.execute({ ...write, out: path.resolve('/tmp/draft.md') })).files[0]?.action,
    ).toBe('unchanged');
    await s.h.fs.writeText(path.resolve('/tmp/stale.md'), derive('# old\n', ORIGIN));
    expect(
      (await s.derive.execute({ ...write, out: path.resolve('/tmp/stale.md') })).files[0]?.action,
    ).toBe('updated');
    await s.h.fs.writeText(path.resolve('/tmp/notes.md'), '# mine\n');
    const kept = await s.derive.execute({ ...write, out: path.resolve('/tmp/notes.md') });
    expect(kept.files[0]?.action, 'a draft never replaces a person file either').toBe('foreign');
    expect(await s.h.fs.readText(path.resolve('/tmp/notes.md'))).toBe('# mine\n');
    await expect(
      s.derive.execute({ ...write, posture: { readOnly: true, source: 'env' } }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
  });
});
