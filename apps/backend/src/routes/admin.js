/**
 * Admin routes (require admin role).
 *
 * GET /api/admin/audit – Query audit log with pagination and filtering
 */
import { queryAuditLog, isAuditEnabled } from '../services/auditService.js';
import { verifySessionToken, isAuthEnabled } from '../services/userService.js';

export function registerAdminRoutes(fastify) {
  // Audit log query
  fastify.get('/api/admin/audit', async (req, reply) => {
    // Require admin auth
    if (isAuthEnabled()) {
      const token = extractToken(req);
      const session = token ? verifySessionToken(token) : null;
      if (!session || session.role !== 'admin') {
        return reply.code(403).send({ ok: false, error: 'Admin access required.' });
      }
    }

    if (!isAuditEnabled()) {
      return { ok: true, entries: [], total: 0, message: 'Audit logging is disabled.' };
    }

    const {
      page = '1',
      pageSize = '50',
      event,
      userId,
      from,
      to,
    } = req.query || {};

    const result = await queryAuditLog({
      page: Math.max(1, parseInt(page, 10) || 1),
      pageSize: Math.min(200, Math.max(1, parseInt(pageSize, 10) || 50)),
      event: event || null,
      userId: userId || null,
      from: from || null,
      to: to || null,
    });

    return { ok: true, ...result };
  });
}

function extractToken(req) {
  const header = req.headers?.authorization || '';
  if (header.startsWith('Bearer ms1.')) {
    return header.slice('Bearer '.length).trim();
  }
  return null;
}
