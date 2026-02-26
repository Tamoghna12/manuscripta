/**
 * Structured audit logging for compliance (FERPA/GDPR).
 *
 * Append-only JSONL file at DATA_DIR/audit.log.
 * Each line: { ts, event, userId, ip, details }
 *
 * Events:
 *   auth.login, auth.register, auth.logout, auth.password_change, auth.oidc_login
 *   project.create, project.delete, project.rename, project.archive, project.trash
 *   file.create, file.edit, file.delete, file.upload
 *   compile.start, compile.done
 *   collab.join, collab.leave
 *   backup.create, backup.restore, backup.delete
 */
import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR } from '../config/constants.js';

const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');
const AUDIT_ENABLED = !['0', 'false', 'no'].includes(
  String(process.env.MANUSCRIPTA_AUDIT_ENABLED || 'true').toLowerCase()
);

/**
 * Write an audit log entry.
 */
export async function audit(event, { userId = null, ip = null, details = {} } = {}) {
  if (!AUDIT_ENABLED) return;
  const entry = {
    ts: new Date().toISOString(),
    event,
    userId,
    ip,
    details,
  };
  try {
    await fs.appendFile(AUDIT_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    // Avoid crashing the app if audit write fails
    console.error('[audit] Write failed:', err.message);
  }
}

/**
 * Query audit logs with pagination and optional filters.
 * Returns { entries, total, page, pageSize }.
 */
export async function queryAuditLog({ page = 1, pageSize = 50, event = null, userId = null, from = null, to = null } = {}) {
  let lines;
  try {
    const raw = await fs.readFile(AUDIT_FILE, 'utf8');
    lines = raw.trim().split('\n').filter(Boolean);
  } catch {
    return { entries: [], total: 0, page, pageSize };
  }

  // Parse and filter
  let entries = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (event && entry.event !== event) continue;
      if (userId && entry.userId !== userId) continue;
      if (from && entry.ts < from) continue;
      if (to && entry.ts > to) continue;
      entries.push(entry);
    } catch { /* skip malformed lines */ }
  }

  // Sort newest first
  entries.reverse();
  const total = entries.length;
  const start = (page - 1) * pageSize;
  const paged = entries.slice(start, start + pageSize);

  return { entries: paged, total, page, pageSize };
}

export function isAuditEnabled() {
  return AUDIT_ENABLED;
}
