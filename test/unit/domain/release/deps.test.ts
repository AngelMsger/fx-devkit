import { describe, expect, it } from 'vitest';

import { depsFinding, scanDependencies } from '../../../../src/domain/release/deps.js';

const pkg = (sections: Record<string, Record<string, string>>): string => JSON.stringify(sections);

describe('dependency scan', () => {
  it('finds -dev, -snapshot and .devN pins in package.json, by section', () => {
    const scan = scanDependencies(
      'package.json',
      pkg({
        dependencies: { '@example/log-sdk': '2.8.3-dev', ok: '^1.0.0', snap: '1.0.0-SNAPSHOT' },
        devDependencies: { tool: '0.1.0.dev1' },
      }),
    );
    expect(scan.offending).toEqual([
      { name: '@example/log-sdk', version: '2.8.3-dev', section: 'dependencies', runtime: true },
      { name: 'snap', version: '1.0.0-SNAPSHOT', section: 'dependencies', runtime: true },
      { name: 'tool', version: '0.1.0.dev1', section: 'devDependencies', runtime: false },
    ]);
  });

  it('does not mistake a devtools package name for a pre-release', () => {
    const scan = scanDependencies('package.json', pkg({ dependencies: { 'dev-tools': '1.2.3' } }));
    expect(scan.offending).toEqual([]);
  });

  it('reads pyproject, requirements and pom the same way', () => {
    expect(
      scanDependencies(
        'pyproject.toml',
        [
          '[project]',
          'dependencies = ["httpx>=0.27", "fxkit==1.2.0.dev3"]',
          '[project.optional-dependencies]',
          'test = ["pytest==8.0.0.dev1"]',
          '[tool.poetry.dependencies]',
          'sdk = "^2.0-dev"',
          'client = { version = "1.2.0-dev", extras = ["cli"] }',
          "agent = '0.9.0-dev'",
          '[build-system]',
          'requires = ["setuptools==70.0.0.dev1"]',
        ].join('\n'),
      ).offending,
    ).toEqual([
      { name: 'fxkit', version: '1.2.0.dev3', section: 'project', runtime: true },
      {
        name: 'pytest',
        version: '8.0.0.dev1',
        section: 'project.optional-dependencies',
        runtime: false,
      },
      { name: 'sdk', version: '^2.0-dev', section: 'tool.poetry.dependencies', runtime: true },
      {
        name: 'client',
        version: '1.2.0-dev',
        section: 'tool.poetry.dependencies',
        runtime: true,
      },
      { name: 'agent', version: '0.9.0-dev', section: 'tool.poetry.dependencies', runtime: true },
      { name: 'setuptools', version: '70.0.0.dev1', section: 'build-system', runtime: false },
    ]);
    expect(
      scanDependencies('requirements.txt', '# pins\nfxkit==1.0.0.dev2\nhttpx>=0.27\n').offending,
    ).toEqual([{ name: 'fxkit', version: '1.0.0.dev2', section: 'requirements', runtime: true }]);
    expect(
      scanDependencies(
        'pom.xml',
        '<dependencies><dependency><groupId>g</groupId><artifactId>core</artifactId><version>1.0-SNAPSHOT</version></dependency>' +
          '<dependency><artifactId>junit</artifactId><version>5.0-SNAPSHOT</version><scope>test</scope></dependency></dependencies>',
      ).offending,
    ).toEqual([
      { name: 'core', version: '1.0-SNAPSHOT', section: 'compile', runtime: true },
      { name: 'junit', version: '5.0-SNAPSHOT', section: 'test', runtime: false },
    ]);
  });

  it('reads a gradle build: coordinates, group maps, and the version variables they interpolate', () => {
    expect(
      scanDependencies(
        'build.gradle',
        [
          'ext {',
          "    sdkVersion = '3.1.7-dev'",
          "    springBootVersion = '2.7.8'",
          "    junitVersion = '5.1-SNAPSHOT'",
          '}',
          'dependencies {',
          '    implementation "com.example:log-sdk:$sdkVersion"',
          "    implementation 'com.example:core:1.4.0-SNAPSHOT'",
          '    implementation group: "org.apache.spark", name: "spark-core", version: "3.1.3"',
          "    testImplementation 'junit:junit:5.0-SNAPSHOT'",
          '    testImplementation "org.junit:junit-api:${junitVersion}"',
          '}',
        ].join('\n'),
      ).offending,
    ).toEqual([
      {
        name: 'com.example:core',
        version: '1.4.0-SNAPSHOT',
        section: 'implementation',
        runtime: true,
      },
      {
        name: 'junit:junit',
        version: '5.0-SNAPSHOT',
        section: 'testImplementation',
        runtime: false,
      },
      { name: 'sdkVersion', version: '3.1.7-dev', section: 'implementation', runtime: true },
      {
        name: 'junitVersion',
        version: '5.1-SNAPSHOT',
        section: 'testImplementation',
        runtime: false,
      },
    ]);
  });

  it('refuses a package.json it cannot parse as a parse error', () => {
    expect(() => scanDependencies('package.json', '{')).toThrow(
      expect.objectContaining({ category: 'parse', code: 'DEPENDENCY_FILE_INVALID' }),
    );
  });
});

describe('depsFinding', () => {
  it('fails on a runtime pre-release, only names a development one, passes a clean file', () => {
    const runtime = depsFinding('a', {
      file: 'package.json',
      offending: [{ name: 'x', version: '1-dev', section: 'dependencies', runtime: true }],
    });
    expect(runtime).toMatchObject({
      level: 'fail',
      message: 'package.json: x 1-dev (dependencies)',
    });
    const dev = depsFinding('a', {
      file: 'package.json',
      offending: [{ name: 'x', version: '1-dev', section: 'devDependencies', runtime: false }],
    });
    expect(dev.level).toBe('ok');
    expect(dev.message).toContain('x 1-dev');
    expect(depsFinding('a', { file: 'package.json', offending: [] })).toMatchObject({
      level: 'ok',
      evidence: { file: 'package.json', offending: [] },
    });
  });

  it('says so when there is no dependency file, and does not fail', () => {
    expect(depsFinding('a', undefined)).toMatchObject({
      group: 'deps',
      id: 'a',
      level: 'ok',
      message: 'no dependency file, not checked',
    });
  });
});
