import React, { useState, useEffect } from 'react';
import {
  mendeleyStatus,
  mendeleyDisconnect,
  mendeleyDocuments,
  mendeleyCatalog,
  mendeleyBibtex,
} from '../../api/client';

interface MendeleyItem {
  id: string;
  title: string;
  authors: string[];
  year: string;
  source: string;
  type: string;
}

interface MendeleyPanelProps {
  bibTarget: string;
  onBibImport: (bibtex: string) => void;
}

const PAGE_SIZE = 25;

export default function MendeleyPanel({ bibTarget, onBibImport }: MendeleyPanelProps) {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'library' | 'catalog'>('library');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<MendeleyItem[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    checkStatus();

    // Listen for OAuth callback
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'mendeley-connected') {
        setConnected(true);
        setStatus('Connected to Mendeley!');
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const checkStatus = async () => {
    setLoading(true);
    try {
      const res = await mendeleyStatus();
      setConnected(res.connected || false);
    } catch {
      setStatus('Could not check Mendeley connection status.');
    }
    setLoading(false);
  };

  const connect = () => {
    window.open('/api/mendeley/auth', 'mendeley-oauth', 'width=600,height=700');
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await mendeleyDisconnect();
      setConnected(false);
      setItems([]);
      setStatus('Disconnected.');
    } catch {
      setStatus('Failed to disconnect.');
    }
    setBusy(false);
  };

  const search = async (pageNum = 0) => {
    setBusy(true);
    setStatus('');
    try {
      const res = tab === 'library'
        ? await mendeleyDocuments({ q: query, limit: PAGE_SIZE, offset: pageNum * PAGE_SIZE })
        : await mendeleyCatalog({ q: query });
      if (res.ok) {
        const newItems = res.items || [];
        setItems(newItems);
        setPage(pageNum);
        setHasMore(newItems.length >= PAGE_SIZE);
        if (pageNum === 0) setSelected({});
      } else {
        setStatus(res.error || 'Search failed.');
      }
    } catch (err: any) {
      setStatus(err.message || 'Error searching Mendeley.');
    }
    setBusy(false);
  };

  const importSelected = async () => {
    const ids = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
    if (!ids.length) {
      setStatus('No items selected.');
      return;
    }
    setBusy(true);
    setStatus('Fetching BibTeX...');
    try {
      const res = await mendeleyBibtex({ documentIds: ids });
      if (res.ok && res.bibtex) {
        onBibImport(res.bibtex);
        setStatus(`Imported ${ids.length} item(s) to ${bibTarget || '.bib'}`);
        setSelected({});
      } else {
        setStatus(res.error || 'BibTeX fetch failed.');
      }
    } catch (err: any) {
      setStatus(err.message || 'Error fetching BibTeX.');
    }
    setBusy(false);
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const selectAll = () => {
    const allSelected = items.every(i => selected[i.id]);
    if (allSelected) {
      setSelected({});
    } else {
      const next: Record<string, boolean> = {};
      items.forEach(i => { next[i.id] = true; });
      setSelected(next);
    }
  };

  const selectedCount = Object.values(selected).filter(Boolean).length;

  if (loading) {
    return <div className="mendeley-panel" style={{ padding: 12 }}>{'Loading...'}</div>;
  }

  return (
    <div className="mendeley-panel">
      <div className="panel-header">
        <div>{'Mendeley'}</div>
      </div>

      {!connected ? (
        <div style={{ padding: 12, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>
            {'Connect your Mendeley account to browse and import references.'}
          </p>
          <button className="primary-btn" onClick={connect}>
            {'Connect Mendeley'}
          </button>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
            {'Requires OAuth app configuration.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 4, padding: '4px 8px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
            <button
              className={`tab-btn-sm ${tab === 'library' ? 'active' : ''}`}
              onClick={() => { setTab('library'); setItems([]); setSelected({}); setPage(0); }}
            >{'My Library'}</button>
            <button
              className={`tab-btn-sm ${tab === 'catalog' ? 'active' : ''}`}
              onClick={() => { setTab('catalog'); setItems([]); setSelected({}); setPage(0); }}
            >{'Catalog'}</button>
            <div style={{ flex: 1 }} />
            <button className="small-btn" onClick={disconnect} disabled={busy} style={{ fontSize: 10, color: 'var(--error)' }}>
              {'Disconnect'}
            </button>
          </div>

          <div style={{ padding: '6px 8px', display: 'flex', gap: 4 }}>
            <input
              className="input-field"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={tab === 'library' ? 'Search your library...' : 'Search Mendeley catalog...'}
              onKeyDown={e => e.key === 'Enter' && search(0)}
              style={{ flex: 1 }}
            />
            <button className="primary-btn" onClick={() => search(0)} disabled={busy}>
              {busy ? '...' : 'Search'}
            </button>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: '0 8px' }}>
            {items.map(item => (
              <div
                key={item.id}
                onClick={() => toggleSelect(item.id)}
                style={{
                  padding: '6px 8px',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: selected[item.id] ? 'var(--selection-bg)' : 'transparent',
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 500 }}>{item.title || '(Untitled)'}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  {item.authors.join(', ')} {item.year ? `(${item.year})` : ''}
                </div>
                {item.source && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    {item.source}
                  </div>
                )}
              </div>
            ))}
            {items.length === 0 && !busy && (
              <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
                {'Search to browse references.'}
              </div>
            )}
          </div>

          {items.length > 0 && (
            <div style={{ padding: '6px 8px', borderTop: '1px solid var(--border)', display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="small-btn" onClick={selectAll} style={{ fontSize: 10 }}>
                {items.every(i => selected[i.id]) ? 'Deselect All' : 'Select All'}
              </button>
              <button
                className="primary-btn"
                onClick={importSelected}
                disabled={busy || selectedCount === 0}
                style={{ fontSize: 11 }}
              >
                {'Import to .bib'} ({selectedCount})
              </button>
              {tab === 'library' && (
                <div style={{ display: 'flex', gap: 2, fontSize: 10 }}>
                  <button className="small-btn" disabled={page === 0 || busy} onClick={() => search(page - 1)}>
                    &laquo;
                  </button>
                  <span style={{ padding: '2px 6px', color: 'var(--text-muted)' }}>
                    {page * PAGE_SIZE + 1}-{page * PAGE_SIZE + items.length}
                  </span>
                  <button className="small-btn" disabled={!hasMore || busy} onClick={() => search(page + 1)}>
                    &raquo;
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {status && (
        <div style={{ padding: '4px 8px', fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
          {status}
        </div>
      )}
    </div>
  );
}
