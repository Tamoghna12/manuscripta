import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { ensureDir, readJson, writeJson, listFilesRecursive } from './fsUtils.js';

function tmpDir() {
  return path.join(os.tmpdir(), `manuscripta_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
}

describe('ensureDir', () => {
  let dir;
  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it('creates nested directories', async () => {
    dir = tmpDir();
    const nested = path.join(dir, 'a', 'b', 'c');
    await ensureDir(nested);
    const stat = await fs.stat(nested);
    expect(stat.isDirectory()).toBe(true);
  });

  it('is idempotent', async () => {
    dir = tmpDir();
    await ensureDir(dir);
    await ensureDir(dir); // should not throw
    const stat = await fs.stat(dir);
    expect(stat.isDirectory()).toBe(true);
  });
});

describe('readJson / writeJson', () => {
  let dir;
  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it('round-trips JSON data', async () => {
    dir = tmpDir();
    await ensureDir(dir);
    const file = path.join(dir, 'test.json');
    const data = { name: 'manuscripta', version: 1, nested: { key: 'val' } };
    await writeJson(file, data);
    const result = await readJson(file);
    expect(result).toEqual(data);
  });
});

describe('listFilesRecursive', () => {
  let dir;
  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it('lists files and directories recursively', async () => {
    dir = tmpDir();
    await ensureDir(path.join(dir, 'sub'));
    await fs.writeFile(path.join(dir, 'main.tex'), 'hello');
    await fs.writeFile(path.join(dir, 'sub', 'ref.bib'), 'bib');

    const items = await listFilesRecursive(dir);
    const paths = items.map((i) => i.path);
    expect(paths).toContain('main.tex');
    expect(paths).toContain('sub');
    expect(paths).toContain(path.join('sub', 'ref.bib'));
  });

  it('skips project.json and .compile', async () => {
    dir = tmpDir();
    await fs.mkdir(path.join(dir, '.compile'), { recursive: true });
    await fs.writeFile(path.join(dir, 'project.json'), '{}');
    await fs.writeFile(path.join(dir, 'main.tex'), 'x');

    const items = await listFilesRecursive(dir);
    const paths = items.map((i) => i.path);
    expect(paths).toContain('main.tex');
    expect(paths).not.toContain('project.json');
    expect(paths).not.toContain('.compile');
  });
});
