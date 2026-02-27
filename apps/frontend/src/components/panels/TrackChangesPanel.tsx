import React, { useState, useMemo } from 'react';
import type { TrackedChange } from '../TrackChangesExtension';

interface TrackChangesPanelProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  changes: TrackedChange[];
  onAccept: (changeId: string) => void;
  onReject: (changeId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onJumpTo: (from: number, to: number) => void;
  readOnly?: boolean;
}

export default function TrackChangesPanel({
  enabled,
  onToggle,
  changes,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
  onJumpTo,
  readOnly,
}: TrackChangesPanelProps) {
  const inserts = useMemo(() => changes.filter(c => c.type === 'insert'), [changes]);
  const deletes = useMemo(() => changes.filter(c => c.type === 'delete'), [changes]);

  return (
    <div className="track-changes-panel">
      <div className="panel-header">
        <div>{'Track Changes'}</div>
      </div>

      <div style={{ padding: '8px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => onToggle(e.target.checked)}
          />
          {'Enable Track Changes'}
        </label>
      </div>

      {enabled && changes.length > 0 && !readOnly && (
        <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 4 }}>
          <button className="primary-btn" onClick={onAcceptAll} style={{ fontSize: 10, flex: 1 }}>
            {'Accept All'} ({changes.length})
          </button>
          <button className="small-btn" onClick={onRejectAll} style={{ fontSize: 10, flex: 1, color: 'var(--error)' }}>
            {'Reject All'} ({changes.length})
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto' }}>
        {changes.length === 0 && enabled && (
          <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
            {'No tracked changes.'}
          </div>
        )}

        {!enabled && (
          <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
            {'Track changes is disabled. Enable it to record edits.'}
          </div>
        )}

        {changes.map(c => (
          <div
            key={c.id}
            style={{
              padding: '6px 8px',
              borderBottom: '1px solid var(--border)',
              fontSize: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{
                background: c.type === 'insert' ? '#22c55e' : '#ef4444',
                color: '#fff',
                borderRadius: 3,
                padding: '0 4px',
                fontSize: 10,
                fontWeight: 600,
              }}>
                {c.type === 'insert' ? '+' : '-'}
              </span>
              <span style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: c.color || '#888',
                display: 'inline-block',
              }} />
              <span style={{ fontSize: 11, fontWeight: 500 }}>{c.author}</span>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                {new Date(c.timestamp).toLocaleString()}
              </span>
            </div>

            <div
              style={{
                padding: '2px 6px',
                borderRadius: 3,
                fontSize: 11,
                fontFamily: 'monospace',
                background: c.type === 'insert' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                cursor: 'pointer',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                textDecoration: c.type === 'delete' ? 'line-through' : 'none',
              }}
              onClick={() => onJumpTo(c.from, c.to)}
              title={'Jump to change'}
            >
              {c.text.length > 80 ? c.text.slice(0, 80) + '...' : c.text}
            </div>

            {!readOnly && (
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <button className="small-btn" onClick={() => onAccept(c.id)} style={{ fontSize: 10 }}>
                  {'Accept'}
                </button>
                <button className="small-btn" onClick={() => onReject(c.id)} style={{ fontSize: 10, color: 'var(--error)' }}>
                  {'Reject'}
                </button>
              </div>
            )}
          </div>
        ))}

        {changes.length > 0 && (
          <div style={{ padding: '4px 8px', fontSize: 10, color: 'var(--text-muted)' }}>
            {inserts.length} {'insertions'}, {deletes.length} {'deletions'}
          </div>
        )}
      </div>
    </div>
  );
}
