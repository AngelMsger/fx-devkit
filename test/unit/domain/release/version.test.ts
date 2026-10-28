import { describe, expect, it } from 'vitest';

import { declaredVersion } from '../../../../src/domain/release/version.js';

describe('declaredVersion', () => {
  it('reads root VERSION as trimmed text and leaves an empty declaration unknown', () => {
    expect(declaredVersion('VERSION', ' 2.1.0\r\n')).toBe('2.1.0');
    expect(declaredVersion('VERSION', ' \r\n')).toBeUndefined();
  });

  it('reads the version a package.json declares, and nothing from a broken one', () => {
    expect(declaredVersion('package.json', '{"name":"api","version":"1.3.0"}')).toBe('1.3.0');
    expect(declaredVersion('package.json', '{"name":"api"}')).toBeUndefined();
    expect(declaredVersion('package.json', '{"version":')).toBeUndefined();
  });

  it('prefers the [project] table of pyproject.toml, then Poetry, never a dependency', () => {
    const poetry = '[tool.poetry]\nname = "api"\nversion = "0.4.1"\n';
    expect(declaredVersion('pyproject.toml', poetry)).toBe('0.4.1');
    const both = `[tool.black]\nversion = "24"\n${poetry}[project]\nversion = '0.5.0'\n`;
    expect(declaredVersion('pyproject.toml', both)).toBe('0.5.0');
    expect(declaredVersion('pyproject.toml', '[tool.black]\nversion = "24"\n')).toBeUndefined();
  });

  it('reads TOML as TOML: commented headers, dynamic versions and other tables', () => {
    expect(declaredVersion('pyproject.toml', '[project] # metadata\nversion = "1.0.0"\n')).toBe(
      '1.0.0',
    );
    const dynamic =
      '[project]\ndynamic = ["version"]\n[tool.other] # settings\nversion = "9.9.9"\n';
    expect(declaredVersion('pyproject.toml', dynamic)).toBeUndefined();
    expect(declaredVersion('pyproject.toml', '[project\nversion = "1"')).toBeUndefined();
  });

  it("reads the project's own <version>, else its parent's, and resolves one property", () => {
    const pom = (own: string) => `<?xml version="1.0"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <!-- <version>9.9.9</version> -->
  <parent><groupId>g</groupId><artifactId>p</artifactId><version>2.0.0</version></parent>
  <artifactId>api</artifactId>
  ${own}
  <properties><revision>1.4.0-SNAPSHOT</revision></properties>
  <dependencies>
    <dependency><artifactId>x</artifactId><version>3.0.0</version></dependency>
  </dependencies>
</project>`;
    expect(declaredVersion('pom.xml', pom('<version>1.3.0</version>'))).toBe('1.3.0');
    expect(declaredVersion('pom.xml', pom(''))).toBe('2.0.0');
    expect(declaredVersion('pom.xml', pom('<version>${revision}</version>'))).toBe(
      '1.4.0-SNAPSHOT',
    );
  });

  it('reads a top-level Gradle version and gradle.properties, not an indented one', () => {
    expect(declaredVersion('build.gradle', "plugins { id 'java' }\nversion = '1.2.0'\n")).toBe(
      '1.2.0',
    );
    expect(declaredVersion('build.gradle', "version '1.2.1'\n")).toBe('1.2.1');
    expect(declaredVersion('build.gradle.kts', 'version = "1.2.2"\n')).toBe('1.2.2');
    expect(declaredVersion('build.gradle', "allprojects {\n  version = '0.0.1'\n}\n")).toBe(
      undefined,
    );
    expect(declaredVersion('gradle.properties', 'group=g\nversion=1.2.3\n')).toBe('1.2.3');
  });

  it('never takes a Gradle version from a comment, nor mistakes a glob for one', () => {
    const block = "/*\nversion = '0.1.0'\n*/\n// version = '0.0.9'\nversion = '1.2.3'\n";
    expect(declaredVersion('build.gradle', block)).toBe('1.2.3');
    const glob =
      "sourceSets { main { java { include '**/*.java' } } }\nversion = '1.2.4' // bumped\n";
    expect(declaredVersion('build.gradle', glob)).toBe('1.2.4');
  });

  it('knows no version in a file that cannot declare one', () => {
    expect(declaredVersion('requirements.txt', 'httpx==0.27\n')).toBeUndefined();
  });
});
