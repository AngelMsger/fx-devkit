// The version a repository declares for itself, from VERSION or a dependency file.
// It finds the written declaration without running a build that might compute another.
// VERSION is plain text; structured metadata uses the readers below.

import path from 'node:path';

import { parse } from 'smol-toml';

import type { VersionDeclaration } from './version-evidence.js';

export type VersionReader = (text: string) => string | undefined;

// A Gradle build often keeps its version beside the build file.
export const GRADLE_PROPERTIES = 'gradle.properties';
export const ROOT_VERSION = 'VERSION';

// Reader order is the automatic declaration discovery order.
export const VERSION_READERS: Readonly<Record<string, VersionReader>> = {
  [ROOT_VERSION]: (text) => text,
  'package.json': packageVersion,
  'pyproject.toml': pyprojectVersion,
  'pom.xml': pomVersion,
  'build.gradle': gradleVersion,
  'build.gradle.kts': gradleVersion,
  [GRADLE_PROPERTIES]: propertiesVersion,
};

export function declaredVersion(file: string, text: string): string | undefined {
  const name = path.posix.basename(file);
  if (!Object.hasOwn(VERSION_READERS, name)) return undefined;
  const reader = VERSION_READERS[name];
  if (reader === undefined) return undefined;
  const version = reader(text)?.trim();
  return version === undefined || version === '' ? undefined : version;
}

// Field names are structural paths, except plain text (text) and Gradle/properties
// assignments (version). A POM property records the field actually carrying the value.
export function versionDeclaration(file: string, text: string): VersionDeclaration | undefined {
  const name = path.posix.basename(file);
  const value = declaredVersion(file, text);
  if (value === undefined) return undefined;
  if (name === 'package.json') {
    const doc: unknown = JSON.parse(text);
    return { file, field: '/version', value, package_name: stringAt(doc, ['name']) ?? null };
  }
  if (name === 'pyproject.toml') {
    const doc: unknown = parse(text);
    const table =
      stringAt(doc, ['project', 'version']) === undefined ? ['tool', 'poetry'] : ['project'];
    return {
      file,
      field: `/${[...table, 'version'].join('/')}`,
      value,
      package_name: stringAt(doc, [...table, 'name']) ?? null,
    };
  }
  if (name === 'pom.xml') {
    const values = pomValues(text);
    const field = values.has('project/version') ? 'project/version' : 'project/parent/version';
    const property = /^\$\{([\w.-]+)\}$/.exec(values.get(field) ?? '')?.[1];
    return {
      file,
      field: `/${property === undefined ? field : `project/properties/${property}`}`,
      value,
      package_name: values.get('project/artifactId') ?? null,
    };
  }
  return { file, field: name === ROOT_VERSION ? 'text' : 'version', value, package_name: null };
}

function packageVersion(text: string): string | undefined {
  try {
    const doc: unknown = JSON.parse(text);
    if (typeof doc !== 'object' || doc === null) return undefined;
    const version = (doc as Record<string, unknown>)['version'];
    return typeof version === 'string' ? version : undefined;
  } catch {
    // The deps check reports a broken file; a version it cannot read is just unknown.
    return undefined;
  }
}

// [project] is the standard table; Poetry projects keep theirs under [tool.poetry].
function pyprojectVersion(text: string): string | undefined {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch {
    // A file that is not TOML declares nothing fx can read.
    return undefined;
  }
  return stringAt(doc, ['project', 'version']) ?? stringAt(doc, ['tool', 'poetry', 'version']);
}

function stringAt(doc: unknown, path: readonly string[]): string | undefined {
  let at = doc;
  for (const key of path)
    at = typeof at === 'object' && at !== null ? (at as Record<string, unknown>)[key] : undefined;
  return typeof at === 'string' ? at : undefined;
}

// The project's own <version>, else the one it inherits from <parent>; a single
// ${property} is resolved from the project's <properties>. Composite and recursive
// expressions are unreadable because fx does not run Maven's expression evaluator.
function pomVersion(text: string): string | undefined {
  const values = pomValues(text);
  const version = values.get('project/version') ?? values.get('project/parent/version');
  const property = version === undefined ? undefined : /^\$\{([\w.-]+)\}$/.exec(version)?.[1];
  const resolved = property === undefined ? version : values.get(`project/properties/${property}`);
  return resolved === undefined || resolved.includes('${') ? undefined : resolved;
}

// The text of every element, keyed by its path from the root.
function pomValues(text: string): Map<string, string> {
  const values = new Map<string, string>();
  const path: string[] = [];
  const body = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
  const TAG = /<(\/?)([\w.:-]+)[^>]*?(\/?)>|([^<]+)/g;
  for (const match of body.matchAll(TAG)) {
    const [, closing, name, selfClosing, content] = match;
    if (content !== undefined) {
      const value = content.trim();
      if (value !== '' && path.length > 0 && !values.has(path.join('/')))
        values.set(path.join('/'), value);
    } else if (name !== undefined && selfClosing !== '/') {
      if (closing === '/') path.pop();
      else path.push(name);
    }
  }
  return values;
}

// `version = '1.2.3'` (Groovy also allows `version '1.2.3'`) at the top level of the build.
function gradleVersion(text: string): string | undefined {
  for (const line of withoutComments(text).split('\n'))
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      const version = /^version\s*=?\s*["']([^"']+)["']/.exec(line)?.[1];
      if (version !== undefined) return version;
    }
  return undefined;
}

// A build script without its // and /* */ comments; a string such as '**/*.java' keeps
// what looks like one, and a block comment keeps its line breaks.
function withoutComments(text: string): string {
  let kept = '';
  let quote: string | undefined;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] ?? '';
    if (quote !== undefined) {
      const escaped = c === '\\' ? (text[i + 1] ?? '') : '';
      kept += c + escaped;
      i += escaped.length;
      if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'") {
      quote = c;
      kept += c;
    } else if (text.startsWith('//', i) || text.startsWith('/*', i)) {
      const block = text[i + 1] === '*';
      const end = block ? text.indexOf('*/', i + 2) : text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end + (block ? 2 : 0);
      kept += block ? text.slice(i, stop).replace(/[^\n]/g, '') : '';
      i = stop - 1;
    } else kept += c;
  }
  return kept;
}

function propertiesVersion(text: string): string | undefined {
  for (const line of text.split('\n')) {
    const version = /^\s*version\s*[=:]\s*(\S+)\s*$/.exec(line)?.[1];
    if (version !== undefined) return version;
  }
  return undefined;
}
