import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { Readable } from 'stream';
import { extractZipBuffer, extractZipStream } from './zipUtils.js';

function tmpDir() {
  return path.join(os.tmpdir(), `manuscripta_zip_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
}

// Minimal zip file containing "hello.txt" with content "hello"
// Generated: echo -n "hello" > hello.txt && zip test.zip hello.txt && base64 -w0 test.zip
const MINIMAL_ZIP = Buffer.from(
  'UEsDBAoAAAAAAEaQVVyGphA2BQAAAAUAAAAJABwAaGVsbG8udHh0VVQJAAMj85lpI/OZaXV4CwABBOGF2D0EAc6KDWhlbGxvUEsBAh4DCgAAAAAARpBVXIamEDYFAAAABQAAAAkAGAAAAAAAAQAAAKSBAAAAAGhlbGxvLnR4dFVUBQADI/OZaXV4CwABBOGF2D0EAc6KDVBLBQYAAAAAAQABAE8AAABIAAAAAAA=',
  'base64'
);

describe('extractZipBuffer', () => {
  let dir;
  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it('extracts files from a zip buffer', async () => {
    dir = tmpDir();
    await fs.mkdir(dir, { recursive: true });
    await extractZipBuffer(MINIMAL_ZIP, dir);
    const content = await fs.readFile(path.join(dir, 'hello.txt'), 'utf8');
    expect(content.trim()).toBe('hello');
  });

  it('respects onEntry filter returning false', async () => {
    dir = tmpDir();
    await fs.mkdir(dir, { recursive: true });
    await extractZipBuffer(MINIMAL_ZIP, dir, {
      onEntry: () => false,
    });
    const files = await fs.readdir(dir);
    expect(files).toHaveLength(0);
  });

  it('uses safeJoinFn when provided', async () => {
    dir = tmpDir();
    await fs.mkdir(dir, { recursive: true });
    const calls = [];
    await extractZipBuffer(MINIMAL_ZIP, dir, {
      safeJoinFn: (base, rel) => {
        calls.push(rel);
        return path.join(base, rel);
      },
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toBe('hello.txt');
  });
});

describe('extractZipStream', () => {
  let dir;
  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it('extracts files from a readable stream', async () => {
    dir = tmpDir();
    await fs.mkdir(dir, { recursive: true });
    const stream = Readable.from([MINIMAL_ZIP]);
    await extractZipStream(stream, dir);
    const content = await fs.readFile(path.join(dir, 'hello.txt'), 'utf8');
    expect(content.trim()).toBe('hello');
  });
});
