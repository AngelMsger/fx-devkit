// The version a repository declares for itself, read from the same dependency file
// the deps check reads. Like those parsers this one is shallow: it finds the version
// a person wrote, it does not run the build that might compute another one.

export type VersionReader = (text: string) => string | undefined;

// A Gradle build often keeps its version beside the build file.
export const GRADLE_PROPERTIES = 'gradle.properties';

export const VERSION_READERS: Readonly<Record<string, VersionReader>> = {
  'package.json': packageVersion,
  'pyproject.toml': pyprojectVersion,
  'pom.xml': pomVersion,
  'build.gradle': gradleVersion,
  'build.gradle.kts': gradleVersion,
  [GRADLE_PROPERTIES]: propertiesVersion,
};

export function declaredVersion(file: string, text: string): string | undefined {
  const reader = VERSION_READERS[file];
  if (reader === undefined) return undefined;
  const version = reader(text)?.trim();
  return version === undefined || version === '' ? undefined : version;
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
  let table = '';
  const found = new Map<string, string>();
  for (const line of text.split('\n')) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header?.[1] !== undefined) {
      table = header[1].trim();
      continue;
    }
    const version = /^\s*version\s*=\s*["']([^"']+)["']/.exec(line)?.[1];
    if (version !== undefined && !found.has(table)) found.set(table, version);
  }
  return found.get('project') ?? found.get('tool.poetry');
}

// The project's own <version>, else the one it inherits from <parent>; a single
// ${property} is resolved from the project's <properties>, as CI-friendly versions use.
function pomVersion(text: string): string | undefined {
  const values = pomValues(text);
  const version = values.get('project/version') ?? values.get('project/parent/version');
  const property = version === undefined ? undefined : /^\$\{([\w.-]+)\}$/.exec(version)?.[1];
  if (property === undefined) return version;
  return values.get(`project/properties/${property}`) ?? version;
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
  for (const line of text.split('\n'))
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      const version = /^version\s*=?\s*["']([^"']+)["']/.exec(line)?.[1];
      if (version !== undefined) return version;
    }
  return undefined;
}

function propertiesVersion(text: string): string | undefined {
  for (const line of text.split('\n')) {
    const version = /^\s*version\s*[=:]\s*(\S+)\s*$/.exec(line)?.[1];
    if (version !== undefined) return version;
  }
  return undefined;
}
