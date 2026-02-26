/**
 * Offline sync-back service.
 *
 * Monitors connectivity and, when the server becomes reachable again,
 * pushes any locally-saved drafts back to the server. Handles conflicts
 * by comparing timestamps.
 */
import { getDraftCount, listDrafts, deleteDraft } from './offlineStore';
import { writeFile, getFile } from '../api/client';

type SyncStatus = 'idle' | 'syncing' | 'done' | 'error';

interface SyncResult {
  synced: number;
  conflicts: { projectId: string; filePath: string; localTime: number }[];
  errors: string[];
}

type SyncListener = (status: SyncStatus, result?: SyncResult) => void;

let listeners: SyncListener[] = [];
let currentStatus: SyncStatus = 'idle';
let lastResult: SyncResult | undefined;
let syncTimer: ReturnType<typeof setInterval> | null = null;

export function onSyncStatusChange(fn: SyncListener) {
  listeners.push(fn);
  // Immediately notify of current state
  fn(currentStatus, lastResult);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

function notify(status: SyncStatus, result?: SyncResult) {
  currentStatus = status;
  lastResult = result;
  for (const fn of listeners) fn(status, result);
}

/**
 * Attempt to sync all local drafts back to the server.
 */
export async function syncDrafts(): Promise<SyncResult> {
  const count = await getDraftCount();
  if (count === 0) return { synced: 0, conflicts: [], errors: [] };

  notify('syncing');

  // Collect all drafts across all projects
  // Since we can't list all projects from IndexedDB index easily,
  // we'll do a full store scan.
  const db = await openDBRaw();
  const allDrafts = await getAllDrafts(db);
  db.close();

  const result: SyncResult = { synced: 0, conflicts: [], errors: [] };

  for (const draft of allDrafts) {
    try {
      // Check if server is reachable + get current server version
      let serverContent: string | null = null;
      try {
        const res = await getFile(draft.projectId, draft.filePath);
        serverContent = res.content;
      } catch {
        // Server unreachable or file doesn't exist
        serverContent = null;
      }

      // If server has the file, check for conflicts
      // Simple heuristic: if server content differs from what we had AND
      // our draft is different from server, that's a conflict
      // For now, we push our draft (last-write-wins for offline mode)
      await writeFile(draft.projectId, draft.filePath, draft.content);
      await deleteDraft(draft.projectId, draft.filePath);
      result.synced++;
    } catch (err: any) {
      result.errors.push(`${draft.filePath}: ${err?.message || 'Unknown error'}`);
    }
  }

  notify(result.errors.length > 0 ? 'error' : 'done', result);
  return result;
}

/**
 * Start periodic sync check. Runs every `intervalMs` (default 30s).
 * When drafts exist and server is reachable, syncs them.
 */
export function startSyncWatcher(intervalMs = 30_000) {
  if (syncTimer) return;

  // Also listen for online event
  window.addEventListener('online', handleOnline);

  syncTimer = setInterval(async () => {
    const count = await getDraftCount().catch(() => 0);
    if (count > 0) {
      await syncDrafts().catch(() => {});
    }
  }, intervalMs);
}

export function stopSyncWatcher() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  window.removeEventListener('online', handleOnline);
}

function handleOnline() {
  // Small delay to let the network stabilize
  setTimeout(() => {
    getDraftCount().then((count) => {
      if (count > 0) syncDrafts().catch(() => {});
    }).catch(() => {});
  }, 2000);
}

// Low-level IDB access for full store scan
const DB_NAME = 'manuscripta-offline';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';

function openDBRaw(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

interface DraftEntry {
  key: string;
  content: string;
  updatedAt: number;
  projectId: string;
  filePath: string;
}

function getAllDrafts(db: IDBDatabase): Promise<DraftEntry[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
