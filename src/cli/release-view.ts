// The release checklist as a person reads it: one block per repository, opening with
// what its release would carry (the version, both branch heads and the commits going
// out), then its checks, so whatever holds a repository back reads in one place.
// Repositories with nothing to report close the output one line each, saying what they
// would release, unless --details asks for their checks. A finding every repository
// shares, such as a tool nobody signed in to, is said once above them. The report
// itself stays the machine interface.

import type { ReleaseFinding, ReleaseReport, ReleaseRepo } from '../domain/release/types.js';
import { shortSha } from '../domain/workspace/commits.js';

import type { Display } from './render/display.js';
import { gap, widthOf } from './render/width.js';

export interface ReleaseView {
  readonly display: Display;
  // List the checks of the repositories with nothing to report too.
  readonly details: boolean;
}

const INDENT = '  ';
const GUTTER = '  ';
const LEVEL_WIDTH = 'fail'.length;
// Below this a wrapped message is a column of fragments; the terminal may wrap it instead.
const NARROWEST_MESSAGE = 24;
// The commits going out a block names; the rest are counted.
const LISTED_COMMITS = 10;

export function releaseText(report: ReleaseReport, view: ReleaseView): string {
  const { display } = view;
  const { findings } = report;
  if (findings.length === 0) return `${display.paint('quiet', '(none)')}\n`;
  const repos = [...new Set(findings.map((f) => f.id))];
  const shared = repos.length > 1 ? sharedFindings(findings, repos.length) : [];
  const own = (repo: string): ReleaseFinding[] =>
    findings.filter((f) => f.id === repo && !shared.some((s) => sameFinding(s, f)));
  const passed = (repo: string): boolean => own(repo).every((f) => f.level === 'ok');
  const listed = repos.filter((repo) => own(repo).length > 0);
  const expanded = view.details ? listed : listed.filter((repo) => !passed(repo));
  const quiet = listed.filter((repo) => !expanded.includes(repo));
  const row = rowOf(display, Math.max(...findings.map((f) => widthOf(f.group))));
  const described = new Map(report.repos.map((r) => [r.name, r]));
  const sections = [
    ...(shared.length === 0
      ? []
      : [[display.paint('strong', 'Every repository'), ...shared.flatMap(row)]]),
    ...expanded.map((repo) => [
      heading(display, repo, own(repo)),
      ...carried(display, described.get(repo)),
      ...own(repo).flatMap(row),
    ]),
    ...(quiet.length === 0
      ? []
      : [
          okLines(
            display,
            shared.length === 0 ? 'All checks ok' : 'Otherwise ok',
            quiet.map((repo) => described.get(repo) ?? repo),
          ),
        ]),
  ];
  return `${sections.map((lines) => lines.join('\n')).join('\n\n')}\n`;
}

// What the release would ship, from the branch it ships from: the version that branch
// declares, its head, and whether everything on the source branch is merged into it.
interface Shipping {
  readonly version: string | undefined;
  readonly text: string;
}

function shipping(repo: ReleaseRepo): Shipping | undefined {
  const { source, target, changes } = repo;
  if (source === null) return undefined;
  if (target === null)
    return {
      version: source.version ?? undefined,
      text: `${source.branch} ${shortSha(source.sha)}`,
    };
  const lands = `${target.branch} ${shortSha(target.sha)}`;
  const version = target.version ?? undefined;
  if (changes !== null && changes.length === 0)
    return { version, text: `${lands}, ${source.branch} merged` };
  const own =
    source.version === null || source.version === target.version ? '' : ` (${source.version})`;
  const from = `${source.branch} ${shortSha(source.sha)}${own}`;
  if (changes === null) return { version, text: `${lands}, ${from}` };
  const count = `${changes.length} commit${changes.length === 1 ? '' : 's'}`;
  return { version, text: `${lands}, ${from} not merged: ${count}` };
}

function sentence(shipped: Shipping): string {
  return shipped.version === undefined ? shipped.text : `${shipped.version}  ${shipped.text}`;
}

// The release sentence, the commits going out and the manifest's note, under a heading.
function carried(display: Display, repo: ReleaseRepo | undefined): string[] {
  if (repo === undefined) return [];
  const room = Math.max(display.room(widthOf(INDENT)), NARROWEST_MESSAGE);
  const shipped = shipping(repo);
  const lines =
    shipped === undefined ? [] : display.wrap(sentence(shipped), room).map((l) => `${INDENT}${l}`);
  const changes = repo.changes ?? [];
  const deeper = `${INDENT}${INDENT}`;
  const commits = changes.slice(0, LISTED_COMMITS).map((c) => {
    const subject = c.message.split('\n')[0] ?? '';
    const line = display.clip(`${subject} (${c.author.name})`, display.room(widthOf(deeper) + 8));
    return `${deeper}${display.paint('quiet', shortSha(c.sha))} ${line}`;
  });
  const more = changes.length - commits.length;
  return [
    ...lines,
    ...commits,
    ...(more > 0 ? [`${deeper}${display.paint('quiet', `and ${more} more`)}`] : []),
    ...noted(display, repo, INDENT),
  ];
}

function noted(display: Display, repo: ReleaseRepo, indent: string): string[] {
  if (repo.note === null) return [];
  const room = Math.max(display.room(widthOf(indent)), NARROWEST_MESSAGE);
  return display
    .wrap(`note: ${repo.note}`, room)
    .map((l) => `${indent}${display.paint('quiet', l)}`);
}

// A problem every repository has in common, the same words and the same fix.
function sharedFindings(findings: readonly ReleaseFinding[], repos: number): ReleaseFinding[] {
  const first = new Map<string, ReleaseFinding>();
  const count = new Map<string, number>();
  for (const f of findings) {
    if (f.level === 'ok') continue;
    const key = keyOf(f);
    if (!first.has(key)) first.set(key, f);
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  return [...first].filter(([key]) => count.get(key) === repos).map(([, f]) => f);
}

function sameFinding(a: ReleaseFinding, b: ReleaseFinding): boolean {
  return keyOf(a) === keyOf(b);
}

function keyOf(f: ReleaseFinding): string {
  return JSON.stringify([f.group, f.level, f.message, f.fix ?? null]);
}

// The repository, then how many of its checks failed or warn; just ok when none did.
function heading(display: Display, repo: string, findings: readonly ReleaseFinding[]): string {
  const counts = (['fail', 'warn'] as const).flatMap((level) => {
    const n = findings.filter((f) => f.level === level).length;
    return n === 0 ? [] : [display.paint(level, `${n} ${level}`)];
  });
  const verdict = counts.length === 0 ? display.paint('ok', 'ok') : counts.join(', ');
  return `${display.paint('strong', repo)}${GUTTER}${verdict}`;
}

// One check: its name, its level and what it found, a message too long for the line
// continuing under its own column, then the command that lets it be answered.
function rowOf(display: Display, width: number): (f: ReleaseFinding) => string[] {
  const lead = widthOf(INDENT) + width + widthOf(GUTTER) + LEVEL_WIDTH + widthOf(GUTTER);
  const room = Math.max(display.room(lead), NARROWEST_MESSAGE);
  const under = ' '.repeat(lead);
  return (f) => {
    // A check that passed is context for the ones that did not.
    const said = (line: string): string => (f.level === 'ok' ? display.paint('quiet', line) : line);
    const [first = '', ...rest] = display.wrap(f.message, room);
    const level = `${display.paint(f.level, f.level)}${gap(f.level, LEVEL_WIDTH)}`;
    return [
      `${INDENT}${f.group}${gap(f.group, width)}${GUTTER}${level}${GUTTER}${said(first)}`,
      ...rest.map((line) => `${under}${said(line)}`),
      ...(f.fix === undefined
        ? []
        : [`${under}${display.mark('step')}${display.paint('accent', f.fix)}`]),
    ];
  };
}

// The repositories with nothing to report, one line each with what they would ship.
function okLines(
  display: Display,
  label: string,
  repos: readonly (ReleaseRepo | string)[],
): string[] {
  const rows = repos.map((repo) =>
    typeof repo === 'string'
      ? { name: repo, shipped: undefined, repo: undefined }
      : { name: repo.name, shipped: shipping(repo), repo },
  );
  const width = Math.max(...rows.map((r) => widthOf(r.name)));
  const versions = rows.flatMap((r) =>
    r.shipped?.version === undefined ? [] : [r.shipped.version],
  );
  const versionWidth = versions.length === 0 ? 0 : Math.max(...versions.map(widthOf));
  const lead = widthOf(INDENT) + width + widthOf(GUTTER);
  const room = Math.max(display.room(lead), NARROWEST_MESSAGE);
  const under = ' '.repeat(lead);
  return [
    display.paint('ok', label),
    ...rows.flatMap(({ name, shipped, repo }) => {
      const said = shipped === undefined ? '' : aligned(shipped, versionWidth);
      const [first = '', ...rest] = said === '' ? [] : display.wrap(said, room);
      return [
        `${INDENT}${name}${first === '' ? '' : `${gap(name, width)}${GUTTER}${first}`}`,
        ...rest.map((l) => `${under}${l}`),
        ...(repo === undefined ? [] : noted(display, repo, under)),
      ];
    }),
  ];
}

// The version in a column of its own, so the branches line up beneath each other.
function aligned(shipped: Shipping, versionWidth: number): string {
  if (versionWidth === 0) return shipped.text;
  const version = shipped.version ?? '';
  return `${version}${gap(version, versionWidth)}${GUTTER}${shipped.text}`;
}
