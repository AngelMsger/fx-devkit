// The reference generator, on a registry small enough to read: what reaches
// the page, in what order, and how a flag's constraints are spelled.
import { describe, expect, it } from 'vitest';

import { renderCliReference } from '../../../scripts/cli-reference.mjs';

const registry = {
  bin: 'fx',
  version: '9.9.9',
  topics: { repo: { description: 'Repositories' }, zoo: {} },
  aliases: { 'repo:ls': 'repo:list' },
  everyday: ['status'],
  globalFlags: { format: { description: 'output format', options: ['human', 'json'] } },
  commands: {
    status: { description: 'What the workspace looks like\nand a second line' },
    'repo:list': { description: 'List repositories', flags: { format: {}, picked: {} } },
    'repo:ls': { description: 'List repositories' },
    'repo:secret': { description: 'Not for the page', hidden: true },
    'zoo:show': {
      description: 'Show one',
      args: { name: { description: 'its name', required: true } },
      examples: ['<%= config.bin %> zoo show a'],
    },
  },
};

const render = (patch: object = {}): string => renderCliReference({ ...registry, ...patch });

describe('the CLI reference generator', () => {
  it('orders everyday commands before topics and keeps hidden commands and aliases out of the body', () => {
    const page = render();
    const headings = [...page.matchAll(/^## `(.+)`$/gm)].map((m) => m[1]);
    expect(headings).toEqual(['fx status', 'fx repo list', 'fx zoo show', 'fx repo ls']);
    expect(page).not.toContain('fx repo secret');
    // The alias keeps an anchor, so existing links still resolve.
    expect(page).toContain('Alias of `fx repo list`.');
    expect(page).toContain('| `fx repo ls` | `fx repo list` |');
  });

  it('summarises a command by its first line and names each topic from the package', () => {
    const page = render();
    expect(page).toContain('| `fx status` | What the workspace looks like |');
    expect(page).toContain('| `fx repo` | Repositories |');
    expect(page).toContain('| `fx zoo` |  |');
  });

  it('spells a flag with its short form, its negation and every constraint it carries', () => {
    const page = render({
      commands: {
        ...registry.commands,
        'zoo:show': {
          description: 'Show one',
          flags: {
            out: { char: 'o', description: 'where to write', required: true },
            colour: { allowNo: true, default: true },
            tag: { multiple: true, exclusive: ['all'], dependsOn: ['out'], env: 'FX_TAG' },
            hidden: { hidden: true },
          },
        },
      },
    });
    expect(page).toContain('| `-o, --out` | where to write (required) |');
    expect(page).toContain('| `--colour / --no-colour` | (default: true) |');
    expect(page).toContain(
      '| `--tag` | (repeatable; exclusive with: --all; requires: --out; env: FX_TAG) |',
    );
    expect(page).not.toContain('--hidden');
    // A global flag is documented once, not again under each command that takes it.
    expect(page.match(/`--format`/g)).toHaveLength(1);
  });

  it('marks the trailing argument of a non-strict command as variadic', () => {
    const page = render({
      commands: {
        'zoo:show': {
          description: 'Show one',
          strict: false,
          args: { name: { required: true }, rest: { description: 'the rest' } },
        },
      },
      everyday: [],
    });
    expect(page).toContain('| `rest` | no | the rest (variadic) |');
    expect(page).toContain('| `name` | yes |  |');
  });
});
