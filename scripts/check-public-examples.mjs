// @ts-check
// Reject deployment-specific SSH ports in public examples without storing a denylist.
// Non-default-port tests use one explicitly synthetic fixture value.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
const listing = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  encoding: 'utf8',
});
if (listing.status !== 0) throw new Error('Could not enumerate repository examples.');
const files = [...new Set(listing.stdout.split('\0').filter(Boolean))];
const url = /ssh:\/\/(?:[^\s/@]+@)?(?:[a-z0-9-]+\.)*example\.(?:com|org|net):([0-9]+)\b/gi;
let failures = 0;
for (const file of files) {
  if (!/\.(?:[cm]?[jt]s|json|ya?ml|md|txt)$/.test(file) || !existsSync(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(url)) {
    const allowed = match[1] === '22' || (file.startsWith('test/') && match[1] === '12345');
    if (allowed) continue;
    const line = text.slice(0, match.index).split('\n').length;
    console.error(
      `${file}:${line}: use a default SSH URL; only tests may use the designated synthetic custom port.`,
    );
    failures++;
  }
}
if (failures) process.exit(1);
console.log('Public SSH example policy passed.');
