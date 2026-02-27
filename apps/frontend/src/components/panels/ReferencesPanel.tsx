import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { BibEntry } from '../../utils/bibParser';

interface ReferencesPanelProps {
  entries: BibEntry[];
  onCite: (keys: string[]) => void;
  onOpenBib: (path: string) => void;
}

type SortMode = 'key' | 'year' | 'author' | 'title';
type GroupMode = 'none' | 'source' | 'year' | 'type';

const TYPE_LABELS: Record<string, string> = {
  article: 'Article',
  inproceedings: 'Conference',
  book: 'Book',
  inbook: 'In Book',
  incollection: 'In Collection',
  phdthesis: 'PhD Thesis',
  mastersthesis: "Master's Thesis",
  techreport: 'Tech Report',
  misc: 'Misc',
  unpublished: 'Unpublished',
  proceedings: 'Proceedings',
};

const TYPE_COLORS: Record<string, string> = {
  article: '#3b82f6',
  inproceedings: '#8b5cf6',
  book: '#059669',
  phdthesis: '#d97706',
  mastersthesis: '#d97706',
  techreport: '#6366f1',
  misc: '#78716c',
};

function formatAuthors(author: string, short = true): string {
  if (!author) return '';
  const parts = author.split(/\s+and\s+/i).map((a) => a.trim());
  if (short && parts.length > 2) return `${parts[0]} et al.`;
  if (short && parts.length === 2) return `${parts[0]} & ${parts[1]}`;
  return parts.join(', ');
}

function highlightMatch(text: string, query: string): JSX.Element {
  if (!query || !text) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: 'var(--accent-soft)', color: 'inherit', borderRadius: 2, padding: '0 1px' }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

/* ── Expanded detail card ── */
function EntryDetail({ entry, query, onCite, onOpenBib }: {
  entry: BibEntry; query: string;
  onCite: (keys: string[]) => void; onOpenBib: (p: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyKey = () => {
    navigator.clipboard.writeText(entry.key).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="ref-detail" onClick={(e) => e.stopPropagation()}>
      {entry.title && (
        <div className="ref-detail-title">{highlightMatch(entry.title, query)}</div>
      )}
      {entry.author && (
        <div className="ref-detail-row">
          <span className="ref-detail-label">{'Authors'}</span>
          <span>{highlightMatch(formatAuthors(entry.author, false), query)}</span>
        </div>
      )}
      {(entry.journal || entry.booktitle) && (
        <div className="ref-detail-row">
          <span className="ref-detail-label">{'Venue'}</span>
          <span style={{ fontStyle: 'italic' }}>{entry.journal || entry.booktitle}</span>
        </div>
      )}
      {entry.year && (
        <div className="ref-detail-row">
          <span className="ref-detail-label">{'Year'}</span>
          <span>{entry.year}</span>
        </div>
      )}
      {entry.doi && (
        <div className="ref-detail-row">
          <span className="ref-detail-label">DOI</span>
          <a
            href={`https://doi.org/${entry.doi}`}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--accent)', fontSize: 11, wordBreak: 'break-all' }}
          >
            {entry.doi}
          </a>
        </div>
      )}
      {entry.abstract && (
        <div className="ref-detail-abstract">{entry.abstract}</div>
      )}
      <div className="ref-detail-actions">
        <button className="ref-action-btn primary" onClick={() => onCite([entry.key])}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
          {'Insert \cite'}
        </button>
        <button className="ref-action-btn" onClick={copyKey}>
          {copied ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          )}
          {copied ? 'Copied!' : 'Copy key'}
        </button>
        {entry.sourcePath && (
          <button className="ref-action-btn" onClick={() => onOpenBib(entry.sourcePath!)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M13 2v7h7"/></svg>
            {entry.sourcePath.split('/').pop()}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Main Panel ── */
export default function ReferencesPanel({ entries, onCite, onOpenBib }: ReferencesPanelProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('key');
  const [groupMode, setGroupMode] = useState<GroupMode>('none');
  const [showControls, setShowControls] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /* Focus search on mount */
  useEffect(() => { searchRef.current?.focus(); }, []);

  /* Keyboard shortcut: Ctrl/Cmd+F to focus search */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        // Only intercept if this panel is visible (search ref exists and is in DOM)
        if (searchRef.current && searchRef.current.offsetParent !== null) {
          e.preventDefault();
          searchRef.current.focus();
          searchRef.current.select();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  /* Filter */
  const filtered = useMemo(() => {
    let result = entries;
    if (query.trim()) {
      const q = query.toLowerCase();
      result = entries.filter(
        (e) =>
          e.key.toLowerCase().includes(q) ||
          e.title.toLowerCase().includes(q) ||
          e.author.toLowerCase().includes(q) ||
          e.year.includes(q) ||
          (e.journal && e.journal.toLowerCase().includes(q)) ||
          (e.booktitle && e.booktitle.toLowerCase().includes(q)),
      );
    }
    /* Sort */
    const sorted = [...result].sort((a, b) => {
      switch (sortMode) {
        case 'year': return (b.year || '0').localeCompare(a.year || '0');
        case 'author': return (a.author || '').localeCompare(b.author || '');
        case 'title': return (a.title || '').localeCompare(b.title || '');
        default: return a.key.localeCompare(b.key);
      }
    });
    return sorted;
  }, [entries, query, sortMode]);

  /* Group */
  const groups = useMemo(() => {
    if (groupMode === 'none') return [{ label: '', entries: filtered }];
    const map = new Map<string, BibEntry[]>();
    for (const e of filtered) {
      let key: string;
      switch (groupMode) {
        case 'source': key = e.sourcePath || 'Unknown'; break;
        case 'year': key = e.year || 'Unknown'; break;
        case 'type': key = TYPE_LABELS[e.type] || e.type; break;
        default: key = '';
      }
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    const result = Array.from(map.entries()).map(([label, entries]) => ({ label, entries }));
    if (groupMode === 'year') result.sort((a, b) => b.label.localeCompare(a.label));
    else result.sort((a, b) => a.label.localeCompare(b.label));
    return result;
  }, [filtered, groupMode]);

  const toggleSelect = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (selected.size === filtered.length && filtered.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((e) => e.key)));
    }
  }, [filtered, selected.size]);

  const citeSelected = useCallback(() => {
    if (selected.size === 0) return;
    onCite(Array.from(selected));
    setSelected(new Set());
  }, [selected, onCite]);

  const toggleExpand = useCallback((key: string) => {
    setExpanded((prev) => (prev === key ? null : key));
  }, []);

  const typeColor = (type: string) => TYPE_COLORS[type] || '#78716c';

  const bibSourceFiles = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => { if (e.sourcePath) set.add(e.sourcePath); });
    return Array.from(set);
  }, [entries]);

  /* ── Empty state ── */
  if (entries.length === 0) {
    return (
      <div className="references-panel">
        <div className="panel-header">
          <span>{'References'}</span>
        </div>
        <div className="ref-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            <path d="M8 7h8"/><path d="M8 11h6"/><path d="M8 15h4"/>
          </svg>
          <div className="ref-empty-title">{'No references yet'}</div>
          <div className="ref-empty-desc">{'Add a .bib file to your project, or import references from Zotero / arXiv to get started.'}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="references-panel">
      {/* ── Header ── */}
      <div className="panel-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>{'References'}</span>
        <span className="ref-badge-count">{entries.length}</span>
        <div style={{ flex: 1 }} />
        <button
          className="ref-icon-btn"
          onClick={() => setShowControls(!showControls)}
          title={'Sort & Group'}
          style={{ opacity: showControls ? 1 : 0.5 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="8" y2="18"/>
          </svg>
        </button>
      </div>

      {/* ── Search ── */}
      <div className="ref-search-bar">
        <svg className="ref-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          ref={searchRef}
          className="ref-search-input"
          type="text"
          placeholder={'Search by key, title, author, year...'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="ref-search-clear" onClick={() => setQuery('')}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        )}
      </div>

      {/* ── Sort/Group controls ── */}
      {showControls && (
        <div className="ref-controls">
          <div className="ref-control-row">
            <span className="ref-control-label">{'Sort'}</span>
            <div className="ref-pill-group">
              {(['key', 'year', 'author', 'title'] as SortMode[]).map((m) => (
                <button key={m} className={`ref-pill ${sortMode === m ? 'active' : ''}`} onClick={() => setSortMode(m)}>
                  {({ key: 'Key', year: 'Year', author: 'Author', title: 'Title' } as Record<string, string>)[m] || m}
                </button>
              ))}
            </div>
          </div>
          <div className="ref-control-row">
            <span className="ref-control-label">{'Group'}</span>
            <div className="ref-pill-group">
              {(['none', 'source', 'year', 'type'] as GroupMode[]).map((m) => (
                <button key={m} className={`ref-pill ${groupMode === m ? 'active' : ''}`} onClick={() => setGroupMode(m)}>
                  {({ none: 'None', source: 'File', year: 'Year', type: 'Type' } as Record<string, string>)[m] || m}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Selection toolbar ── */}
      {selected.size > 0 && (
        <div className="ref-selection-bar">
          <button className="ref-action-btn primary" onClick={citeSelected}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
            {`Cite (${selected.size})`}
          </button>
          <button className="ref-action-btn" onClick={selectAll}>
            {selected.size === filtered.length ? 'Deselect all' : 'Select all'}
          </button>
          <button className="ref-action-btn" onClick={() => setSelected(new Set())}>
            {'Cancel'}
          </button>
        </div>
      )}

      {/* ── Results count ── */}
      {query && (
        <div className="ref-result-count">
          {filtered.length === 0
            ? 'No matches.'
            : `${filtered.length} of ${entries.length} entries`}
        </div>
      )}

      {/* ── Entry list ── */}
      <div className="ref-list" ref={listRef}>
        {filtered.length === 0 && query ? (
          <div className="ref-no-results">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5" style={{ opacity: 0.3 }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              <line x1="8" y1="8" x2="14" y2="14"/><line x1="14" y1="8" x2="8" y2="14"/>
            </svg>
            <span>{'No matches.'}</span>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label || '__all'}>
              {group.label && (
                <div className="ref-group-header">
                  {groupMode === 'source' ? (
                    <button className="ref-group-link" onClick={() => onOpenBib(group.label)}>
                      {group.label.split('/').pop()}
                    </button>
                  ) : (
                    <span>{group.label}</span>
                  )}
                  <span className="ref-group-count">{group.entries.length}</span>
                </div>
              )}
              {group.entries.map((entry) => {
                const isExpanded = expanded === entry.key;
                const isSelected = selected.has(entry.key);
                return (
                  <div
                    key={entry.key}
                    className={`ref-entry ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''}`}
                    onClick={() => toggleExpand(entry.key)}
                  >
                    <div className="ref-entry-main">
                      <input
                        type="checkbox"
                        className="ref-checkbox"
                        checked={isSelected}
                        onChange={(e) => { e.stopPropagation(); toggleSelect(entry.key); }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="ref-entry-body">
                        <div className="ref-entry-top">
                          <span
                            className="ref-type-badge"
                            style={{ background: typeColor(entry.type) + '18', color: typeColor(entry.type) }}
                          >
                            {TYPE_LABELS[entry.type] || entry.type}
                          </span>
                          <span className="ref-cite-key">{highlightMatch(entry.key, query)}</span>
                          {entry.year && <span className="ref-year">{entry.year}</span>}
                        </div>
                        {entry.title && (
                          <div className="ref-entry-title">{highlightMatch(entry.title, query)}</div>
                        )}
                        <div className="ref-entry-meta">
                          {entry.author && (
                            <span className="ref-authors">{highlightMatch(formatAuthors(entry.author), query)}</span>
                          )}
                          {(entry.journal || entry.booktitle) && (
                            <span className="ref-venue">{entry.journal || entry.booktitle}</span>
                          )}
                        </div>
                      </div>
                      <svg className={`ref-expand-arrow ${isExpanded ? 'open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    </div>
                    {isExpanded && (
                      <EntryDetail entry={entry} query={query} onCite={onCite} onOpenBib={onOpenBib} />
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* ── Footer ── */}
      <div className="ref-footer">
        <span className="ref-footer-text">
          {bibSourceFiles.length} .bib {bibSourceFiles.length === 1 ? 'file' : 'files'}
        </span>
        <div style={{ flex: 1 }} />
        {filtered.length > 0 && selected.size === 0 && (
          <button className="ref-action-btn" onClick={selectAll} style={{ fontSize: 10 }}>
            {'Select all'}
          </button>
        )}
      </div>
    </div>
  );
}
