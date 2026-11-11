import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';

describe('GitHub test workflow', () => {
  it('tests the exact minimum Bun version and rolling latest Bun', async () => {
    const workflow = await readFile(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8');
    const matrixBlock = workflow.match(/matrix:\s*\n\s+bun-version:\s*\[([^\]]+)\]/u)?.[1] ?? '';
    const matrixValues = matrixBlock.split(',').map((value) => value.trim().replaceAll(/["']/g, ''));

    expect(matrixValues).toEqual(['1.4.0', 'latest']);

    expect(workflow).toContain('bun-version: ${{ matrix.bun-version }}');
  });

  it('runs the project test suite through Bun', async () => {
    const workflow = await readFile(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8');

    expect(workflow).toMatch(/run:\s*bun run test/u);
    expect(workflow).not.toMatch(/run:\s*bun test\b/u);
  });
});
