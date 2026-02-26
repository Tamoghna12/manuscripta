import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { DATA_DIR } from '../config/constants.js';
import {
  fetchZoteroItems,
  fetchZoteroCollections,
  fetchZoteroBibtex,
  readLocalZoteroDb,
  detectLocalZoteroDb,
} from '../services/zoteroService.js';

const CONFIG_PATH = path.join(DATA_DIR, 'zotero-config.json');

async function readConfig() {
  try {
    if (!existsSync(CONFIG_PATH)) return null;
    return JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function writeConfig(config) {
  await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

export function registerZoteroRoutes(fastify) {
  // Save config
  fastify.post('/api/zotero/config', async (req) => {
    const { userId, apiKey } = req.body || {};
    if (!userId || !apiKey) {
      return { ok: false, error: 'userId and apiKey are required.' };
    }
    await writeConfig({ userId, apiKey });
    return { ok: true };
  });

  // Get config (apiKey masked)
  fastify.get('/api/zotero/config', async () => {
    const config = await readConfig();
    if (!config) return { ok: true, config: null };
    return {
      ok: true,
      config: {
        userId: config.userId,
        apiKey: config.apiKey ? '***' + config.apiKey.slice(-4) : '',
        hasKey: !!config.apiKey,
      },
    };
  });

  // Search cloud library
  fastify.get('/api/zotero/items', async (req) => {
    const config = await readConfig();
    if (!config) return { ok: false, error: 'Zotero not configured. Save userId and apiKey first.' };
    const { q, limit, start, collectionKey } = req.query || {};
    try {
      const result = await fetchZoteroItems(config.userId, config.apiKey, {
        query: q,
        limit: Math.min(50, Math.max(1, Number(limit) || 25)),
        start: Math.max(0, Number(start) || 0),
        collectionKey,
      });
      const items = result.items.map(item => ({
        key: item.key,
        title: item.data?.title || '',
        creators: (item.data?.creators || []).map(c =>
          c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim()
        ),
        date: item.data?.date || '',
        itemType: item.data?.itemType || '',
        publicationTitle: item.data?.publicationTitle || '',
      }));
      return { ok: true, items, totalResults: result.totalResults };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // List collections
  fastify.get('/api/zotero/collections', async () => {
    const config = await readConfig();
    if (!config) return { ok: false, error: 'Zotero not configured.' };
    try {
      const raw = await fetchZoteroCollections(config.userId, config.apiKey);
      const collections = raw.map(c => ({
        key: c.key,
        name: c.data?.name || '',
        parentCollection: c.data?.parentCollection || false,
        numItems: c.meta?.numItems || 0,
      }));
      return { ok: true, collections };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Get BibTeX for selected items
  fastify.post('/api/zotero/bibtex', async (req) => {
    const config = await readConfig();
    if (!config) return { ok: false, error: 'Zotero not configured.' };
    const { itemKeys } = req.body || {};
    if (!itemKeys || !itemKeys.length) {
      return { ok: false, error: 'No item keys provided.' };
    }
    try {
      const bibtex = await fetchZoteroBibtex(config.userId, config.apiKey, itemKeys);
      return { ok: true, bibtex };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Read local Zotero database
  fastify.get('/api/zotero/local', async (req) => {
    const { dbPath } = req.query || {};
    try {
      const items = await readLocalZoteroDb(dbPath || null);
      const detected = detectLocalZoteroDb();
      return { ok: true, items, dbPath: detected };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}
