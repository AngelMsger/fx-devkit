// Pre-release pins in the one dependency file a repository's language names.
// The parsers find versions, they do not resolve them; see "Dependencies" in
// docs/design/release.md.

import { DevkitError } from '../errors.js';

import { releaseFinding, type ReleaseFinding } from './types.js';

export interface Offender {
  readonly name: string;
  readonly version: string;
  readonly section: string;
  // A runtime dependency fails the check; a development one is only named.
  readonly runtime: boolean;
}

export interface DependencyScan {
  readonly file: string;
  readonly offending: readonly Offender[];
}

export const PRERELEASE = /-dev\b|\.dev\d*\b|-snapshot\b/i;

type Parser = (text: string) => Offender[];

export const DEPENDENCY_FILES: readonly { readonly file: string; readonly parse: Parser }[] = [
  { file: 'package.json', parse: parsePackageJson },
  { file: 'pyproject.toml', parse: parsePyproject },
  { file: 'requirements.txt', parse: parseRequirements },
  { file: 'pom.xml', parse: parsePom },
  { file: 'build.gradle', parse: parseGradle },
  { file: 'build.gradle.kts', parse: parseGradle },
];

export function scanDependencies(file: string, text: string): DependencyScan {
  const parser = DEPENDENCY_FILES.find((d) => d.file === file)?.parse;
  if (parser === undefined) {
    throw new DevkitError('internal', 'DEPENDENCY_FILE_UNKNOWN', `No parser for ${file}`);
  }
  return { file, offending: parser(text) };
}

export function depsFinding(repo: string, scan: DependencyScan | undefined): ReleaseFinding {
  if (scan === undefined)
    return releaseFinding('deps', repo, 'ok', 'no dependency file, not checked', {
      coverage: 'not_applicable',
    });
  const evidence = { file: scan.file, offending: scan.offending };
  const runtime = scan.offending.filter((o) => o.runtime);
  if (runtime.length > 0) {
    return releaseFinding('deps', repo, 'fail', `${scan.file}: ${list(runtime)}`, { evidence });
  }
  if (scan.offending.length > 0) {
    return releaseFinding(
      'deps',
      repo,
      'ok',
      `${scan.file}: pre-release only outside runtime: ${list(scan.offending)}`,
      { evidence },
    );
  }
  return releaseFinding('deps', repo, 'ok', `${scan.file}: no pre-release dependency`, {
    evidence,
  });
}

function list(offenders: readonly Offender[]): string {
  return offenders.map((o) => `${o.name} ${o.version} (${o.section})`).join(', ');
}

const NPM_SECTIONS: readonly { readonly section: string; readonly runtime: boolean }[] = [
  { section: 'dependencies', runtime: true },
  { section: 'optionalDependencies', runtime: true },
  { section: 'peerDependencies', runtime: true },
  { section: 'devDependencies', runtime: false },
];

function parsePackageJson(text: string): Offender[] {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new DevkitError('parse', 'DEPENDENCY_FILE_INVALID', 'package.json is not valid JSON', {
      cause: err,
      nextSteps: [
        'Fix the JSON syntax in the repository package.json, then re-run fx release check.',
      ],
    });
  }
  const root = typeof doc === 'object' && doc !== null ? (doc as Record<string, unknown>) : {};
  return NPM_SECTIONS.flatMap(({ section, runtime }) => {
    const deps = root[section];
    if (typeof deps !== 'object' || deps === null) return [];
    return Object.entries(deps as Record<string, unknown>).flatMap(([name, version]) =>
      typeof version === 'string' && PRERELEASE.test(version)
        ? [{ name, version, section, runtime }]
        : [],
    );
  });
}

// A requirement line: name, optional extras, a comparator, the version.
const REQUIREMENT = /^\s*([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*[=~!<>]=?\s*([^\s;#,"']+)/;
const POETRY = /^\s*([A-Za-z0-9_.-]+)\s*=\s*['"]([^'"]+)['"]/;
// Poetry also writes `sdk = { version = "1.2.0", extras = [...] }`.
const POETRY_TABLE = /^\s*([A-Za-z0-9_.-]+)\s*=\s*\{[^}]*?version\s*=\s*['"]([^'"]+)['"]/;
const NOT_RUNTIME = /dev|test|optional|group|build-system/i;

function parsePyproject(text: string): Offender[] {
  const offenders: Offender[] = [];
  let section = '';
  for (const line of text.split('\n')) {
    const header = /^\s*\[([^\]]+)\]/.exec(line);
    if (header?.[1] !== undefined) {
      section = header[1];
      continue;
    }
    const quoted = /"([^"]+)"|'([^']+)'/g;
    const candidates = [...line.matchAll(quoted)].map((m) => m[1] ?? m[2] ?? '');
    const table = POETRY_TABLE.exec(line);
    if (table?.[1] !== undefined && table[2] !== undefined) {
      if (PRERELEASE.test(table[2])) offenders.push(offender(table[1], table[2], section));
      continue;
    }
    const poetry = POETRY.exec(line);
    if (poetry?.[1] !== undefined && poetry[2] !== undefined && PRERELEASE.test(poetry[2])) {
      offenders.push(offender(poetry[1], poetry[2], section));
      continue;
    }
    for (const candidate of candidates) {
      const m = REQUIREMENT.exec(candidate);
      if (m?.[1] !== undefined && m[2] !== undefined && PRERELEASE.test(m[2]))
        offenders.push(offender(m[1], m[2], section));
    }
  }
  return offenders;
}

function offender(name: string, version: string, section: string): Offender {
  return { name, version, section: section || 'project', runtime: !NOT_RUNTIME.test(section) };
}

function parseRequirements(text: string): Offender[] {
  return text.split('\n').flatMap((line) => {
    if (line.trim().startsWith('#')) return [];
    const m = REQUIREMENT.exec(line);
    return m?.[1] !== undefined && m[2] !== undefined && PRERELEASE.test(m[2])
      ? [{ name: m[1], version: m[2], section: 'requirements', runtime: true }]
      : [];
  });
}

function parsePom(text: string): Offender[] {
  const offenders: Offender[] = [];
  for (const block of text.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const body = block[1] ?? '';
    const name = /<artifactId>\s*([^<]+?)\s*<\/artifactId>/.exec(body)?.[1];
    const version = /<version>\s*([^<]+?)\s*<\/version>/.exec(body)?.[1];
    const scope = /<scope>\s*([^<]+?)\s*<\/scope>/.exec(body)?.[1] ?? 'compile';
    if (name !== undefined && version !== undefined && PRERELEASE.test(version))
      offenders.push({ name, version, section: scope, runtime: scope !== 'test' });
  }
  return offenders;
}

// Gradle writes a dependency three ways — a "group:artifact:version"
// coordinate, a group/name/version map, and a version held in a variable
// the coordinate interpolates. The third is why variables are read too: a
// coordinate ending in ${sdkVersion} hides its own version.
const GRADLE_COORDINATE = /['"]([\w.-]+:[\w.-]+):([^'"$]+)['"]/;
const GRADLE_MAP = /name\s*:\s*['"]([\w.-]+)['"][\s\S]*?version\s*:\s*['"]([^'"]+)['"]/;
const GRADLE_VARIABLE =
  /^\s*(?:def\s+|val\s+|var\s+)?([A-Za-z_]\w*[Vv]ersion)\s*=\s*['"]([^'"]+)['"]/;
const GRADLE_CONFIGURATION = /^\s*(\w+)\s*[( '"]/;
const GRADLE_NOT_RUNTIME = /test|classpath|checkstyle|jacoco|annotationProcessor/i;

function parseGradle(text: string): Offender[] {
  const lines = text.split('\n').filter((line) => !line.trim().startsWith('//'));
  const offenders: Offender[] = [];
  const variables = new Map<string, string>();
  for (const line of lines) {
    const section = GRADLE_CONFIGURATION.exec(line)?.[1] ?? 'dependencies';
    const runtime = !GRADLE_NOT_RUNTIME.test(section);
    const variable = GRADLE_VARIABLE.exec(line);
    if (variable?.[1] !== undefined && variable[2] !== undefined) {
      variables.set(variable[1], variable[2]);
      continue;
    }
    const coordinate = GRADLE_COORDINATE.exec(line);
    if (coordinate?.[1] !== undefined && coordinate[2] !== undefined) {
      if (PRERELEASE.test(coordinate[2]))
        offenders.push({ name: coordinate[1], version: coordinate[2], section, runtime });
      continue;
    }
    const map = GRADLE_MAP.exec(line);
    if (map?.[1] !== undefined && map[2] !== undefined && PRERELEASE.test(map[2]))
      offenders.push({ name: map[1], version: map[2], section, runtime });
  }
  return [...offenders, ...interpolated(lines, variables)];
}

// A version variable is as much of a runtime pin as the configurations that
// interpolate it; one nothing uses ships nowhere and is only named.
function interpolated(lines: readonly string[], variables: Map<string, string>): Offender[] {
  return [...variables]
    .filter(([, version]) => PRERELEASE.test(version))
    .map(([name, version]) => {
      const USES = new RegExp(`\\$\\{${name}\\}|\\$${name}\\b`);
      const used = lines.filter((line) => USES.test(line));
      const sections = used.map((line) => GRADLE_CONFIGURATION.exec(line)?.[1] ?? 'dependencies');
      return {
        name,
        version,
        section: sections[0] ?? 'version',
        runtime: sections.some((s) => !GRADLE_NOT_RUNTIME.test(s)),
      };
    });
}
