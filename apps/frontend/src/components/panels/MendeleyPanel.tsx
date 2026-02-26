import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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

export default function MendeleyPanel({ bibTarget, onBibImport }: MendeleyPanelProps) {
  const { t } = useTranslation();
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'library' | 'catalog'>('library');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<MendeleyItem[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

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
    } catch { /* ignore */ }
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
    } catch { /* ignore */ }
    setBusy(false);
  };

  const search = async () => {
    setBusy(true);
    setStatus('');
    try {
      const res = tab === 'library'
        ? await mendeleyDocuments({ q: query })
        : await mendeleyCatalog({ q: query });
      if (res.ok) {
        setItems(res.items || []);
        setSelected({});
      } else {
        setStatus(res.error || 'Search failed.');
      }
    } catch (err: any) {
      setStatus(err.message || 'Error.');
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
      setStatus(err.message);
    }
    setBusy(false);
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const selectedCount = Object.values(selected).filter(Boolean).length;

  if (loading) {
    return <div className="mendeley-panel" style={{ padding: 12 }}>{t('Loading...')}</div>;
  }

  return (
    <div className="mendeley-panel">
      <div className="panel-header">
        <div>{t('Mendeley')}</div>
      </div>

      {!connected ? (
        <div style={{ padding: 12, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>
            {t('Connect your Mendeley account to browse and import references.')}
          </p>
          <button className="primary-btn" onClick={connect}>
            {t('Connect Mendeley')}
          </button>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
            {t('Requires OAuth app configuration.')}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 4, padding: '4px 8px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
            <button
              className={`tab-btn-sm ${tab === 'library' ? 'active' : ''}`}
              onClick={() => setTab('library')}
            >{t('My Library')}</button>
            <button
              className={`tab-btn-sm ${tab === 'catalog' ? 'active' : ''}`}
              onClick={() => setTab('catalog')}
            >{t('Catalog')}</button>
            <div style={{ flex: 1 }} />
            <button className="small-btn" onClick={disconnect} disabled={busy} style={{ fontSize: 10, color: 'var(--error)' }}>
              {t('Disconnect')}
            </button>
          </div>

          <div style={{ padding: '6px 8px', display: 'flex', gap: 4 }}>
            <input
              className="input-field"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={tab === 'library' ? t('Search your library...') : t('Search Mendeley catalog...')}
              onKeyDown={e => e.key === 'Enter' && search()}
              style={{ flex: 1 }}
            />
            <button className="primary-btn" onClick={search} disabled={busy}>
              {busy ? '...' : t('Search')}
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
                {t('Search to browse references.')}
              </div>
            )}
          </div>

          {items.length > 0 && (
            <div style={{ padding: '6px 8px', borderTop: '1px solid var(--border)', display: 'flex', gap: 4 }}>
              <button
                className="primary-btn"
                onClick={importSelected}
                disabled={busy || selectedCount === 0}
                style={{ fontSize: 11 }}
              >
                {t('Import to .bib')} ({selectedCount})
              </button>
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
