import React, { useState, useEffect, useCallback } from 'react';
import {
  zoteroGetConfig,
  zoteroSaveConfig,
  zoteroItems,
  zoteroCollections,
  zoteroBibtex,
  zoteroLocal,
  zoteroLocalBibtex,
} from '../../api/client';

interface ZoteroItem {
  key: string;
  title: string;
  creators: string[];
  date: string;
  itemType: string;
  publicationTitle: string;
}

interface ZoteroCollection {
  key: string;
  name: string;
  parentCollection: string | false;
  numItems: number;
}

interface ZoteroPanelProps {
  projectId: string;
  bibTarget: string;
  onBibImport: (bibtex: string) => void;
}

export default function ZoteroPanel({ projectId, bibTarget, onBibImport }: ZoteroPanelProps) {
  const [tab, setTab] = useState<'cloud' | 'local' | 'config'>('cloud');
  const [userId, setUserId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ZoteroItem[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [page, setPage] = useState(0);
  const [collections, setCollections] = useState<ZoteroCollection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [localItems, setLocalItems] = useState<any[]>([]);
  const [localDbPath, setLocalDbPath] = useState('');
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const [localSelected, setLocalSelected] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setConfigLoading(true);
    try {
      const res = await zoteroGetConfig();
      if (res.ok && res.config && res.config.hasKey) {
        setConfigured(true);
        setUserId(res.config.userId || '');
        loadCollections();
      }
    } catch { /* ignore */ }
    setConfigLoading(false);
  };

  const saveConfig = async () => {
    if (!userId.trim() || !apiKey.trim()) {
      setStatus('User ID and API Key are required.');
      return;
    }
    setBusy(true);
    try {
      const res = await zoteroSaveConfig({ userId: userId.trim(), apiKey: apiKey.trim() });
      if (res.ok) {
        setConfigured(true);
        setStatus('Configuration saved.');
        setTab('cloud');
        loadCollections();
      } else {
        setStatus(res.error || 'Failed to save config.');
      }
    } catch (err: any) {
      setStatus(err.message || 'Error saving config.');
    }
    setBusy(false);
  };

  const loadCollections = async () => {
    try {
      const res = await zoteroCollections();
      if (res.ok) setCollections(res.collections || []);
    } catch { /* ignore */ }
  };

  const search = async (pageNum = 0) => {
    setBusy(true);
    setStatus('');
    try {
      const res = await zoteroItems({
        q: query,
        limit: 25,
        start: pageNum * 25,
        collectionKey: selectedCollection || undefined,
      });
      if (res.ok) {
        setItems(res.items || []);
        setTotalResults(res.totalResults || 0);
        setPage(pageNum);
        setSelected({});
      } else {
        setStatus(res.error || 'Search failed.');
      }
    } catch (err: any) {
      setStatus(err.message || 'Error searching Zotero.');
    }
    setBusy(false);
  };

  const importSelected = async () => {
    const keys = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
    if (!keys.length) {
      setStatus('No items selected.');
      return;
    }
    setBusy(true);
    setStatus('Fetching BibTeX...');
    try {
      const res = await zoteroBibtex({ itemKeys: keys });
      if (res.ok && res.bibtex) {
        onBibImport(res.bibtex);
        setStatus(`Imported ${keys.length} item(s) to ${bibTarget || '.bib'}`);
        setSelected({});
      } else {
        setStatus(res.error || 'BibTeX fetch failed.');
      }
    } catch (err: any) {
      setStatus(err.message || 'Error fetching BibTeX.');
    }
    setBusy(false);
  };

  const loadLocal = async () => {
    setLocalBusy(true);
    setLocalError('');
    try {
      const res = await zoteroLocal({ dbPath: localDbPath || undefined });
      if (res.ok) {
        setLocalItems(res.items || []);
        setLocalSelected({});
        if (res.dbPath) setLocalDbPath(res.dbPath);
      } else {
        setLocalError(res.error || 'Failed to read local database.');
      }
    } catch (err: any) {
      setLocalError(err.message || 'Error reading local Zotero.');
    }
    setLocalBusy(false);
  };

  const toggleLocalSelect = (key: string) => {
    setLocalSelected(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const selectAllLocal = () => {
    const allSelected = localItems.every(i => localSelected[i.itemKey]);
    if (allSelected) {
      setLocalSelected({});
    } else {
      const next: Record<string, boolean> = {};
      localItems.forEach(i => { if (i.itemKey) next[i.itemKey] = true; });
      setLocalSelected(next);
    }
  };

  const importLocalSelected = async () => {
    const keys = Object.entries(localSelected).filter(([, v]) => v).map(([k]) => k);
    if (!keys.length) {
      setStatus('No items selected.');
      return;
    }
    const selectedItems = localItems.filter(i => keys.includes(i.itemKey));
    setLocalBusy(true);
    setStatus('Generating BibTeX...');
    try {
      const res = await zoteroLocalBibtex({ items: selectedItems });
      if (res.ok && res.bibtex) {
        onBibImport(res.bibtex);
        setStatus(`Imported ${selectedItems.length} local item(s) to ${bibTarget || '.bib'}`);
        setLocalSelected({});
      } else {
        setStatus(res.error || 'BibTeX generation failed.');
      }
    } catch (err: any) {
      setStatus(err.message || 'Error generating BibTeX.');
    }
    setLocalBusy(false);
  };

  const localSelectedCount = Object.values(localSelected).filter(Boolean).length;

  const toggleSelect = (key: string) => {
    setSelected(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const selectAll = () => {
    const allSelected = items.every(i => selected[i.key]);
    if (allSelected) {
      setSelected({});
    } else {
      const next: Record<string, boolean> = {};
      items.forEach(i => { next[i.key] = true; });
      setSelected(next);
    }
  };

  const selectedCount = Object.values(selected).filter(Boolean).length;

  if (configLoading) {
    return <div className="zotero-panel" style={{ padding: 12 }}>{'Loading...'}</div>;
  }

  return (
    <div className="zotero-panel">
      <div className="panel-header">
        <div>{'Zotero'}</div>
      </div>

      <div className="zotero-tabs" style={{ display: 'flex', gap: 4, padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
        <button
          className={`tab-btn-sm ${tab === 'cloud' ? 'active' : ''}`}
          onClick={() => setTab('cloud')}
        >{'Cloud'}</button>
        <button
          className={`tab-btn-sm ${tab === 'local' ? 'active' : ''}`}
          onClick={() => setTab('local')}
        >{'Local'}</button>
        <button
          className={`tab-btn-sm ${tab === 'config' ? 'active' : ''}`}
          onClick={() => setTab('config')}
        >{'Config'}</button>
      </div>

      {tab === 'config' && (
        <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11 }}>{'Zotero User ID'}</label>
          <input
            className="input-field"
            value={userId}
            onChange={e => setUserId(e.target.value)}
            placeholder="12345678"
          />
          <label style={{ fontSize: 11 }}>{'Zotero API Key'}</label>
          <input
            className="input-field"
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="xxxxxxxxxxxxxxxxxxxxxxxx"
          />
          <button className="primary-btn" onClick={saveConfig} disabled={busy}>
            {'Save'}
          </button>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {'Get your API key from'}{' '}
            <a href="https://www.zotero.org/settings/keys" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
              zotero.org/settings/keys
            </a>
          </div>
        </div>
      )}

      {tab === 'cloud' && !configured && (
        <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)' }}>
          <p>{'Zotero not configured.'}</p>
          <button className="primary-btn" onClick={() => setTab('config')} style={{ marginTop: 8 }}>
            {'Configure'}
          </button>
        </div>
      )}

      {tab === 'cloud' && configured && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {collections.length > 0 && (
              <select
                className="input-field"
                value={selectedCollection}
                onChange={e => setSelectedCollection(e.target.value)}
                style={{ fontSize: 11 }}
              >
                <option value="">{'All Collections'}</option>
                {collections.map(c => (
                  <option key={c.key} value={c.key}>{c.name} ({c.numItems})</option>
                ))}
              </select>
            )}
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                className="input-field"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={'Search Zotero library...'}
                onKeyDown={e => e.key === 'Enter' && search()}
                style={{ flex: 1 }}
              />
              <button className="primary-btn" onClick={() => search()} disabled={busy}>
                {busy ? '...' : 'Search'}
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: '0 8px' }}>
            {items.map(item => (
              <div
                key={item.key}
                className={`zotero-item ${selected[item.key] ? 'selected' : ''}`}
                onClick={() => toggleSelect(item.key)}
                style={{
                  padding: '6px 8px',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: selected[item.key] ? 'var(--selection-bg)' : 'transparent',
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 500 }}>{item.title || '(Untitled)'}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  {item.creators.join(', ')} {item.date ? `(${item.date})` : ''}
                </div>
                {item.publicationTitle && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    {item.publicationTitle}
                  </div>
                )}
              </div>
            ))}
            {items.length === 0 && !busy && (
              <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
                {'Search your Zotero library above.'}
              </div>
            )}
          </div>

          {items.length > 0 && (
            <div style={{ padding: '6px 8px', borderTop: '1px solid var(--border)', display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="small-btn" onClick={selectAll} style={{ fontSize: 10 }}>
                {items.every(i => selected[i.key]) ? 'Deselect All' : 'Select All'}
              </button>
              <button
                className="primary-btn"
                onClick={importSelected}
                disabled={busy || selectedCount === 0}
                style={{ fontSize: 11 }}
              >
                {'Import to .bib'} ({selectedCount})
              </button>
              {totalResults > 25 && (
                <div style={{ display: 'flex', gap: 2, fontSize: 10 }}>
                  <button className="small-btn" disabled={page === 0} onClick={() => search(page - 1)}>
                    &laquo;
                  </button>
                  <span style={{ padding: '2px 6px', color: 'var(--text-muted)' }}>
                    {page * 25 + 1}-{Math.min((page + 1) * 25, totalResults)} / {totalResults}
                  </span>
                  <button className="small-btn" disabled={(page + 1) * 25 >= totalResults} onClick={() => search(page + 1)}>
                    &raquo;
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'local' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11 }}>{'Database Path (auto-detected)'}</label>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                className="input-field"
                value={localDbPath}
                onChange={e => setLocalDbPath(e.target.value)}
                placeholder="~/.zotero/zotero/.../zotero.sqlite"
                style={{ flex: 1, fontSize: 11 }}
              />
              <button className="primary-btn" onClick={loadLocal} disabled={localBusy}>
                {localBusy ? '...' : 'Load'}
              </button>
            </div>
            {localError && <div style={{ fontSize: 11, color: 'var(--error)' }}>{localError}</div>}
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '0 8px' }}>
            {localItems.map((item, idx) => (
              <div
                key={item.itemKey || idx}
                onClick={() => item.itemKey && toggleLocalSelect(item.itemKey)}
                style={{
                  padding: '6px 8px',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 12,
                  cursor: 'pointer',
                  background: localSelected[item.itemKey] ? 'var(--selection-bg)' : 'transparent',
                }}
              >
                <div style={{ fontWeight: 500 }}>{item.title || '(Untitled)'}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  {Array.isArray(item.authors) ? item.authors.join(', ') : item.authors}
                  {item.date ? ` (${item.date})` : ''}
                </div>
              </div>
            ))}
            {localItems.length === 0 && !localBusy && (
              <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
                {'Click Load to read your local Zotero database.'}
              </div>
            )}
          </div>

          {localItems.length > 0 && (
            <div style={{ padding: '6px 8px', borderTop: '1px solid var(--border)', display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="small-btn" onClick={selectAllLocal} style={{ fontSize: 10 }}>
                {localItems.every(i => localSelected[i.itemKey]) ? 'Deselect All' : 'Select All'}
              </button>
              <button
                className="primary-btn"
                onClick={importLocalSelected}
                disabled={localBusy || localSelectedCount === 0}
                style={{ fontSize: 11 }}
              >
                {'Import to .bib'} ({localSelectedCount})
              </button>
              {localItems.length >= 200 && (
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {'Showing first 200 items'}
                </span>
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
