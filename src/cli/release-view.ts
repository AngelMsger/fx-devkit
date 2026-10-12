// The release checklist as a person reads it: one block per repository with its checks
// under it, so whatever holds a repository back reads in one place. Repositories with
// nothing to report share one closing line unless --details asks for their checks. A
// finding every repository shares, such as a tool nobody signed in to, is said once
// above them. The report itself stays the machine interface.

import type { ReleaseFinding, ReleaseReport } from '../domain/release/types.js';

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
  const sections = [
    ...(shared.length === 0
      ? []
      : [[display.paint('strong', 'Every repository'), ...shared.flatMap(row)]]),
    ...expanded.map((repo) => [heading(display, repo, own(repo)), ...own(repo).flatMap(row)]),
    ...(quiet.length === 0
      ? []
      : [okLines(display, shared.length === 0 ? 'All checks ok:' : 'Otherwise ok:', quiet)]),
  ];
  return `${sections.map((lines) => lines.join('\n')).join('\n\n')}\n`;
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

function okLines(display: Display, label: string, repos: readonly string[]): string[] {
  const room = Math.max(display.room(widthOf(INDENT)), NARROWEST_MESSAGE);
  const [first = '', ...rest] = display.wrap(`${label} ${repos.join(', ')}`, room);
  const painted = `${display.paint('ok', label)}${first.slice(label.length)}`;
  return [painted, ...rest.map((line) => `${INDENT}${line}`)];
}
