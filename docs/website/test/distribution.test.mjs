// A single Markdown source must not leak another channel's installation instructions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { distributionMarkdown } from '../distribution.mjs';

test('all four installation guides select only the channel package', async () => {
  for (const file of [
    '../../user-guide.md',
    '../i18n/ja/getting-started.md',
    '../i18n/zh-Hans/getting-started.md',
    '../i18n/zh-Hant/getting-started.md',
  ]) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    for (const [channel, expected, other] of [
      ['internal', '@fx/devkit', '@angelmsger/fx'],
      ['public', '@angelmsger/fx', '@fx/devkit'],
    ]) {
      const rendered = distributionMarkdown(source, channel);
      assert.ok(rendered.includes(`npm install -g ${expected}`));
      assert.ok(!rendered.includes(`npm install -g ${other}`));
    }
  }
});
test('malformed or unknown channel blocks fail before rendering', () => {
  assert.throws(() => distributionMarkdown('<!-- distribution:internal -->\nunfinished', 'public'));
  assert.throws(() =>
    distributionMarkdown('<!-- distribution:unknown -->\ntext\n<!-- /distribution -->', 'public'),
  );
});
