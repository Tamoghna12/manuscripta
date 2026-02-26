import {
  buildAuthorizationUrl,
  generateAndSaveState,
  verifyState,
  exchangeCodeForToken,
  isConnected,
  deleteTokens,
  getValidToken,
  fetchDocuments,
  searchCatalog,
  documentToBibtex,
} from '../services/mendeleyService.js';

export function registerMendeleyRoutes(fastify) {
  // Start OAuth flow — redirect to Mendeley
  fastify.get('/api/mendeley/auth', async (req, reply) => {
    try {
      const state = await generateAndSaveState();
      const url = buildAuthorizationUrl(state);
      return reply.redirect(url);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // OAuth callback
  fastify.get('/api/mendeley/callback', async (req, reply) => {
    const { code, state, error } = req.query || {};
    if (error) {
      return reply.type('text/html').send(`<html><body><h3>Authorization denied</h3><script>window.close();</script></body></html>`);
    }
    if (!code || !state) {
      return reply.type('text/html').send(`<html><body><h3>Missing parameters</h3><script>window.close();</script></body></html>`);
    }
    const valid = await verifyState(state);
    if (!valid) {
      return reply.type('text/html').send(`<html><body><h3>Invalid or expired state</h3><script>window.close();</script></body></html>`);
    }
    try {
      await exchangeCodeForToken(code);
      return reply.type('text/html').send(`
        <html><body>
          <h3>Connected to Mendeley!</h3>
          <p>You can close this window.</p>
          <script>
            if (window.opener) window.opener.postMessage({ type: 'mendeley-connected' }, '*');
            setTimeout(() => window.close(), 1500);
          </script>
        </body></html>
      `);
    } catch (err) {
      return reply.type('text/html').send(`<html><body><h3>Error: ${err.message}</h3><script>window.close();</script></body></html>`);
    }
  });

  // Check connection status
  fastify.get('/api/mendeley/status', async () => {
    const connected = await isConnected();
    return { ok: true, connected };
  });

  // Disconnect
  fastify.post('/api/mendeley/disconnect', async () => {
    await deleteTokens();
    return { ok: true };
  });

  // Fetch user's documents
  fastify.get('/api/mendeley/documents', async (req) => {
    const token = await getValidToken();
    if (!token) return { ok: false, error: 'Not connected to Mendeley.' };
    const { q, limit, offset } = req.query || {};
    try {
      const docs = await fetchDocuments(token, {
        query: q,
        limit: Math.min(50, Math.max(1, Number(limit) || 20)),
        offset: Math.max(0, Number(offset) || 0),
      });
      const items = docs.map(doc => ({
        id: doc.id,
        title: doc.title || '',
        authors: (doc.authors || []).map(a => `${a.first_name || ''} ${a.last_name || ''}`.trim()),
        year: doc.year || '',
        source: doc.source || '',
        type: doc.type || '',
      }));
      return { ok: true, items };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Search Mendeley catalog
  fastify.get('/api/mendeley/catalog', async (req) => {
    const token = await getValidToken();
    if (!token) return { ok: false, error: 'Not connected to Mendeley.' };
    const { q } = req.query || {};
    if (!q) return { ok: false, error: 'Query required.' };
    try {
      const results = await searchCatalog(token, q);
      const items = results.map(doc => ({
        id: doc.id,
        title: doc.title || '',
        authors: (doc.authors || []).map(a => `${a.first_name || ''} ${a.last_name || ''}`.trim()),
        year: doc.year || '',
        source: doc.source || '',
        type: doc.type || '',
      }));
      return { ok: true, items };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Convert selected documents to BibTeX
  fastify.post('/api/mendeley/bibtex', async (req) => {
    const token = await getValidToken();
    if (!token) return { ok: false, error: 'Not connected to Mendeley.' };
    const { documentIds } = req.body || {};
    if (!documentIds || !documentIds.length) {
      return { ok: false, error: 'No document IDs provided.' };
    }
    try {
      // Fetch full documents by querying user's library
      const docs = await fetchDocuments(token, { limit: 50 });
      const selected = docs.filter(d => documentIds.includes(d.id));
      const bibtex = selected.map(d => documentToBibtex(d)).join('\n');
      return { ok: true, bibtex };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}
