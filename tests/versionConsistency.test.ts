import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';

const read = (relativePath: string) => readFile(new URL(relativePath, import.meta.url), 'utf8');

describe('version consistency', () => {
  it('keeps package.json, the release-please manifest, and CHANGELOG.md on the same version', async () => {
    const [pkg, manifest, changelog] = await Promise.all([
      read('../package.json'),
      read('../.release-please-manifest.json'),
      read('../CHANGELOG.md'),
    ]);

    const version = JSON.parse(pkg).version as string;
    const manifestVersion = (JSON.parse(manifest) as Record<string, string>)['.'];
    const releasedVersions = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gmu)].map((match) => match[1]);

    expect(version).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(manifestVersion).toBe(version);
    expect(releasedVersions[0]).toBe(version);
  });

  it('documents the current version in CHANGELOG.md', async () => {
    const [pkg, changelog] = await Promise.all([read('../package.json'), read('../CHANGELOG.md')]);
    const { version } = JSON.parse(pkg) as { version: string };

    // release-please writes `## [1.0.1](https://.../compare/...) (date)`, so only assert the heading.
    expect(changelog).toMatch(new RegExp(`^## \\[${version.replaceAll('.', '\\.')}\\]`, 'mu'));
    expect(changelog).toMatch(/^# Changelog$/mu);
  });

  it('reads the version from package.json regardless of the working directory', async () => {
    const source = await read('../src/utils/logBanner.ts');

    expect(source).toContain("new URL('../../package.json', import.meta.url)");
    expect(source).not.toContain("Bun.file('package.json')");
  });
});
