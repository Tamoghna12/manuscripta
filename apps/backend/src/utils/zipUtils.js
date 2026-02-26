import { promises as fs, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';
import { ensureDir } from './fsUtils.js';

/**
 * Extract a zip buffer to a target directory.
 * Calls onEntry(relPath, type) for each entry — return false to skip.
 * Uses yauzl-promise (no vulnerable transitive deps).
 */
export async function extractZipBuffer(zipBuffer, targetDir, { onEntry, safeJoinFn } = {}) {
  const yauzl = await import('yauzl-promise');
  const zipReader = await yauzl.fromBuffer(zipBuffer);
  try {
    for await (const entry of zipReader) {
      const relPath = entry.filename.replace(/\\/g, '/');
      const isDir = relPath.endsWith('/');

      if (onEntry) {
        const skip = onEntry(relPath, isDir ? 'Directory' : 'File');
        if (skip === false) continue;
      }

      let abs;
      if (safeJoinFn) {
        try {
          abs = safeJoinFn(targetDir, relPath);
        } catch {
          continue; // skip unsafe paths
        }
      } else {
        abs = path.join(targetDir, relPath);
      }

      if (isDir) {
        await ensureDir(abs);
        continue;
      }

      await ensureDir(path.dirname(abs));
      const readStream = await entry.openReadStream();
      await pipeline(readStream, createWriteStream(abs));
    }
  } finally {
    await zipReader.close();
  }
}

/**
 * Extract a zip from a readable stream to a target directory.
 * Buffers the entire stream first, then uses yauzl.
 */
export async function extractZipStream(stream, targetDir, opts = {}) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  return extractZipBuffer(buffer, targetDir, opts);
}
