import path from 'path';
import { readFile } from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import os from 'os';

const ZOTERO_API_BASE = 'https://api.zotero.org';
const ZOTERO_API_VERSION = '3';

/**
 * Fetch items from Zotero cloud library.
 */
export async function fetchZoteroItems(userId, apiKey, { query, limit = 25, start = 0, collectionKey } = {}) {
  let url = `${ZOTERO_API_BASE}/users/${encodeURIComponent(userId)}/items?format=json&limit=${limit}&start=${start}`;
  if (collectionKey) {
    url = `${ZOTERO_API_BASE}/users/${encodeURIComponent(userId)}/collections/${encodeURIComponent(collectionKey)}/items?format=json&limit=${limit}&start=${start}`;
  }
  if (query) url += `&q=${encodeURIComponent(query)}`;
  url += '&itemType=-attachment+-note';

  const res = await fetch(url, {
    headers: {
      'Zotero-API-Key': apiKey,
      'Zotero-API-Version': ZOTERO_API_VERSION,
    },
  });
  if (!res.ok) {
    throw new Error(`Zotero API error: ${res.status} ${res.statusText}`);
  }
  const totalResults = Number(res.headers.get('Total-Results') || 0);
  const items = await res.json();
  return { items, totalResults };
}

/**
 * Fetch collections from Zotero cloud library.
 */
export async function fetchZoteroCollections(userId, apiKey) {
  const url = `${ZOTERO_API_BASE}/users/${encodeURIComponent(userId)}/collections?format=json&limit=100`;
  const res = await fetch(url, {
    headers: {
      'Zotero-API-Key': apiKey,
      'Zotero-API-Version': ZOTERO_API_VERSION,
    },
  });
  if (!res.ok) {
    throw new Error(`Zotero API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * Fetch BibTeX for specific item keys from Zotero cloud.
 */
export async function fetchZoteroBibtex(userId, apiKey, itemKeys) {
  if (!itemKeys || !itemKeys.length) return '';
  const keys = Array.isArray(itemKeys) ? itemKeys.join(',') : itemKeys;
  const url = `${ZOTERO_API_BASE}/users/${encodeURIComponent(userId)}/items?format=bibtex&itemKey=${encodeURIComponent(keys)}`;
  const res = await fetch(url, {
    headers: {
      'Zotero-API-Key': apiKey,
      'Zotero-API-Version': ZOTERO_API_VERSION,
    },
  });
  if (!res.ok) {
    throw new Error(`Zotero BibTeX fetch error: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/**
 * Auto-detect local Zotero SQLite database path.
 */
export function detectLocalZoteroDb() {
  const homeDir = os.homedir();
  const candidates = [];

  if (process.platform === 'linux') {
    candidates.push(path.join(homeDir, '.zotero', 'zotero'));
    candidates.push(path.join(homeDir, 'Zotero'));
  } else if (process.platform === 'darwin') {
    candidates.push(path.join(homeDir, 'Zotero'));
    candidates.push(path.join(homeDir, 'Library', 'Application Support', 'Zotero', 'Profiles'));
  } else if (process.platform === 'win32') {
    candidates.push(path.join(homeDir, 'Zotero'));
    const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
    candidates.push(path.join(appData, 'Zotero', 'Zotero', 'Profiles'));
  }

  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    const dbPath = path.join(dir, 'zotero.sqlite');
    if (existsSync(dbPath)) return dbPath;
    // Check profile subdirectories
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const sub = path.join(dir, entry.name, 'zotero.sqlite');
          if (existsSync(sub)) return sub;
        }
      }
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * Read items from local Zotero SQLite database using sql.js (lazy-loaded).
 */
export async function readLocalZoteroDb(dbPath) {
  if (!dbPath) {
    dbPath = detectLocalZoteroDb();
  }
  if (!dbPath || !existsSync(dbPath)) {
    throw new Error('Zotero database not found. Please specify the path to zotero.sqlite.');
  }

  // Lazy-load sql.js
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();

  const buf = await readFile(dbPath);
  const db = new SQL.Database(buf);

  try {
    const results = db.exec(`
      SELECT
        i.itemID,
        i.key as itemKey,
        idv.value as title,
        GROUP_CONCAT(DISTINCT c.firstName || ' ' || c.lastName) as authors,
        idv2.value as date,
        idv3.value as publicationTitle,
        it.typeName as itemType
      FROM items i
      JOIN itemTypes it ON i.itemTypeID = it.itemTypeID
      LEFT JOIN itemData id ON i.itemID = id.itemID
      LEFT JOIN itemDataValues idv ON id.valueID = idv.valueID AND id.fieldID = (SELECT fieldID FROM fields WHERE fieldName = 'title')
      LEFT JOIN itemData id2 ON i.itemID = id2.itemID
      LEFT JOIN itemDataValues idv2 ON id2.valueID = idv2.valueID AND id2.fieldID = (SELECT fieldID FROM fields WHERE fieldName = 'date')
      LEFT JOIN itemData id3 ON i.itemID = id3.itemID
      LEFT JOIN itemDataValues idv3 ON id3.valueID = idv3.valueID AND id3.fieldID = (SELECT fieldID FROM fields WHERE fieldName = 'publicationTitle')
      LEFT JOIN itemCreators ic ON i.itemID = ic.itemID
      LEFT JOIN creators c ON ic.creatorID = c.creatorID
      WHERE it.typeName NOT IN ('attachment', 'note', 'annotation')
        AND i.itemID NOT IN (SELECT itemID FROM deletedItems)
      GROUP BY i.itemID
      ORDER BY i.dateModified DESC
      LIMIT 200
    `);

    if (!results.length) return [];

    const columns = results[0].columns;
    return results[0].values.map(row => {
      const item = {};
      columns.forEach((col, idx) => { item[col] = row[idx]; });
      item.authors = item.authors ? item.authors.split(',').map(a => a.trim()) : [];
      return item;
    });
  } finally {
    db.close();
  }
}
