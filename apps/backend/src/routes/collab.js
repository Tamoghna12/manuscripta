import crypto from 'crypto';
import path from 'path';
import { readJson } from '../utils/fsUtils.js';
import { getProjectRoot } from '../services/projectService.js';
import { safeJoin } from '../utils/pathUtils.js';
import { isTextFile } from '../utils/texUtils.js';
import { issueToken, verifyToken } from '../services/collab/tokenService.js';
import { getOrCreateDoc, setupConnection, flushDocNow, getDocDiagnostics } from '../services/collab/docStore.js';
import { getClientIp, isLocalAddress } from '../utils/authUtils.js';

// ── WebRTC Signaling rooms ──
// Map<roomKey, Map<peerId, WebSocket>>
const signalingRooms = new Map();

export function registerCollabRoutes(fastify) {
  fastify.post('/api/projects/:id/collab/invite', async (req) => {
    const { id } = req.params;
    const { role, displayName, color } = req.body || {};
    await getProjectRoot(id);
    const validRole = ['admin', 'editor', 'viewer'].includes(role) ? role : 'editor';
    const token = issueToken({ projectId: id, role: validRole, displayName, color });
    return { ok: true, token, role: validRole };
  });

  fastify.get('/api/collab/resolve', async (req, reply) => {
    const { token } = req.query || {};
    const tokenValue = Array.isArray(token) ? token[0] : token;
    const payload = verifyToken(tokenValue);
    if (!payload) {
      reply.code(401);
      return { ok: false, error: 'Invalid token' };
    }
    const projectRoot = await getProjectRoot(payload.projectId);
    let projectName = payload.projectId;
    try {
      const meta = await readJson(path.join(projectRoot, 'project.json'));
      projectName = meta?.name || projectName;
    } catch {
      // ignore
    }
    return { ok: true, projectId: payload.projectId, projectName, role: payload.role };
  });

  fastify.post('/api/projects/:id/collab/flush', async (req) => {
    const { id } = req.params;
    const { path: filePath } = req.body || {};
    if (!filePath) return { ok: false, error: 'Missing path' };
    await getProjectRoot(id);
    const key = `${id}:${filePath}`;
    await flushDocNow(key);
    return { ok: true };
  });

  fastify.get('/api/projects/:id/collab/status', async (req) => {
    const { id } = req.params;
    const { path: filePath } = req.query || {};
    if (!filePath) return { ok: false, error: 'Missing path' };
    await getProjectRoot(id);
    const key = `${id}:${filePath}`;
    const diagnostics = getDocDiagnostics(key);
    return { ok: true, diagnostics };
  });

  fastify.get('/api/collab', { websocket: true }, async (conn, req) => {
    const { token, projectId, file } = req.query || {};
    const tokenValue = Array.isArray(token) ? token[0] : token;
    const filePath = Array.isArray(file) ? file[0] : file;
    const projectParam = Array.isArray(projectId) ? projectId[0] : projectId;
    const isLocal = isLocalAddress(getClientIp(req));
    let payload = null;
    if (tokenValue) {
      payload = verifyToken(tokenValue);
    } else if (!isLocal) {
      conn.socket.close(1008, 'Unauthorized');
      return;
    }
    const effectiveProjectId = payload?.projectId || projectParam;
    if (!effectiveProjectId || !filePath) {
      conn.socket.close(1008, 'Missing project or file');
      return;
    }
    if (payload && projectParam && payload.projectId !== projectParam) {
      conn.socket.close(1008, 'Project mismatch');
      return;
    }
    if (!payload && !isLocal) {
      conn.socket.close(1008, 'Unauthorized');
      return;
    }
    let projectRoot = '';
    try {
      projectRoot = await getProjectRoot(effectiveProjectId);
    } catch {
      conn.socket.close(1008, 'Project not found');
      return;
    }
    if (!isTextFile(filePath)) {
      conn.socket.close(1003, 'Binary file');
      return;
    }
    let absPath = '';
    try {
      absPath = safeJoin(projectRoot, filePath);
    } catch {
      conn.socket.close(1008, 'Invalid path');
      return;
    }
    const metaPath = path.join(projectRoot, 'project.json');
    const key = `${effectiveProjectId}:${filePath}`;
    const doc = await getOrCreateDoc({ key, absPath, metaPath });
    const connRole = payload?.role || 'admin';
    const connDisplayName = payload?.displayName || null;
    setupConnection(doc, conn.socket, { role: connRole, displayName: connDisplayName });
  });

  // ── WebRTC signaling endpoint ──
  // Lightweight relay: peers in the same room exchange offer/answer/ICE.
  // Protocol (JSON text frames):
  //   → { type: 'join' }               – server replies with { type: 'peers', ids: [...] }
  //   → { type: 'signal', to, data }   – relayed to target peer as { type: 'signal', from, data }
  //   ← { type: 'peer-joined', id }    – broadcast when a new peer joins
  //   ← { type: 'peer-left', id }      – broadcast when a peer disconnects
  fastify.get('/api/collab/signal', { websocket: true }, async (conn, req) => {
    const { token, projectId, file } = req.query || {};
    const tokenValue = Array.isArray(token) ? token[0] : token;
    const filePath = Array.isArray(file) ? file[0] : file;
    const projectParam = Array.isArray(projectId) ? projectId[0] : projectId;
    const isLocal = isLocalAddress(getClientIp(req));

    // Auth – same logic as /api/collab
    let payload = null;
    if (tokenValue) {
      payload = verifyToken(tokenValue);
    } else if (!isLocal) {
      conn.socket.close(1008, 'Unauthorized');
      return;
    }
    const effectiveProjectId = payload?.projectId || projectParam;
    if (!effectiveProjectId || !filePath) {
      conn.socket.close(1008, 'Missing project or file');
      return;
    }
    if (payload && projectParam && payload.projectId !== projectParam) {
      conn.socket.close(1008, 'Project mismatch');
      return;
    }
    if (!payload && !isLocal) {
      conn.socket.close(1008, 'Unauthorized');
      return;
    }

    const roomKey = `${effectiveProjectId}:${filePath}`;
    const peerId = crypto.randomUUID();

    // Get or create room
    if (!signalingRooms.has(roomKey)) {
      signalingRooms.set(roomKey, new Map());
    }
    const room = signalingRooms.get(roomKey);

    // Notify existing peers
    for (const [existingId, existingWs] of room) {
      if (existingWs.readyState === 1) {
        existingWs.send(JSON.stringify({ type: 'peer-joined', id: peerId }));
      }
    }

    room.set(peerId, conn.socket);

    // Send peerId and list of existing peers
    conn.socket.send(JSON.stringify({
      type: 'welcome',
      id: peerId,
      peers: Array.from(room.keys()).filter(id => id !== peerId),
    }));

    conn.socket.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
      } catch {
        return;
      }

      if (msg.type === 'signal' && msg.to && msg.data) {
        const target = room.get(msg.to);
        if (target && target.readyState === 1) {
          target.send(JSON.stringify({ type: 'signal', from: peerId, data: msg.data }));
        }
      }
    });

    conn.socket.on('close', () => {
      room.delete(peerId);
      if (room.size === 0) {
        signalingRooms.delete(roomKey);
      } else {
        for (const [, ws] of room) {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'peer-left', id: peerId }));
          }
        }
      }
    });

    conn.socket.on('error', () => {
      // handled by close
    });
  });
}
