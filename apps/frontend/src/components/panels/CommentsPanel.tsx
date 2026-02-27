import React, { useState, useMemo } from 'react';
import type { CommentThread } from '../CommentExtension';

interface CommentsPanelProps {
  comments: CommentThread[];
  onAddComment: (anchorFrom: number, anchorTo: number, anchorText: string, content: string) => void;
  onReply: (commentId: string, content: string) => void;
  onResolve: (commentId: string, resolved: boolean) => void;
  onDelete: (commentId: string) => void;
  onJumpTo: (from: number, to: number) => void;
  selectionRange: { from: number; to: number; text: string } | null;
  authorName: string;
  authorColor: string;
  readOnly?: boolean;
}

export default function CommentsPanel({
  comments,
  onAddComment,
  onReply,
  onResolve,
  onDelete,
  onJumpTo,
  selectionRange,
  authorName,
  authorColor,
  readOnly,
}: CommentsPanelProps) {
  const [newComment, setNewComment] = useState('');
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [showResolved, setShowResolved] = useState(false);

  const active = useMemo(() => comments.filter(c => !c.resolved), [comments]);
  const resolved = useMemo(() => comments.filter(c => c.resolved), [comments]);

  const handleAdd = () => {
    if (!selectionRange || !newComment.trim()) return;
    onAddComment(selectionRange.from, selectionRange.to, selectionRange.text, newComment.trim());
    setNewComment('');
  };

  const handleReply = (commentId: string) => {
    const text = replyText[commentId]?.trim();
    if (!text) return;
    onReply(commentId, text);
    setReplyText(prev => ({ ...prev, [commentId]: '' }));
  };

  const renderThread = (comment: CommentThread) => (
    <div
      key={comment.id}
      style={{
        padding: '8px',
        borderBottom: '1px solid var(--border)',
        opacity: comment.resolved ? 0.6 : 1,
      }}
    >
      <div
        style={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer', marginBottom: 4 }}
        onClick={() => onJumpTo(comment.anchorFrom, comment.anchorTo)}
        title={'Jump to location'}
      >
        "{comment.anchorText.length > 50 ? comment.anchorText.slice(0, 50) + '...' : comment.anchorText}"
      </div>

      {comment.thread.map(msg => (
        <div key={msg.id} style={{ marginBottom: 4, fontSize: 12 }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 2 }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: msg.authorColor || '#888',
              display: 'inline-block',
            }} />
            <strong style={{ fontSize: 11 }}>{msg.authorName}</strong>
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
              {new Date(msg.createdAt).toLocaleString()}
            </span>
          </div>
          <div style={{ paddingLeft: 12 }}>{msg.content}</div>
        </div>
      ))}

      {!readOnly && (
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <input
            className="input-field"
            value={replyText[comment.id] || ''}
            onChange={e => setReplyText(prev => ({ ...prev, [comment.id]: e.target.value }))}
            placeholder={'Reply...'}
            onKeyDown={e => e.key === 'Enter' && handleReply(comment.id)}
            style={{ flex: 1, fontSize: 11 }}
          />
          <button className="small-btn" onClick={() => handleReply(comment.id)} style={{ fontSize: 10 }}>
            {'Reply'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        {!readOnly && (
          <button
            className="small-btn"
            onClick={() => onResolve(comment.id, !comment.resolved)}
            style={{ fontSize: 10 }}
          >
            {comment.resolved ? 'Unresolve' : 'Resolve'}
          </button>
        )}
        {!readOnly && (
          <button
            className="small-btn"
            onClick={() => onDelete(comment.id)}
            style={{ fontSize: 10, color: 'var(--error)' }}
          >
            {'Delete'}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="comments-panel">
      <div className="panel-header">
        <div>{'Comments'} ({active.length})</div>
      </div>

      {!readOnly && selectionRange && (
        <div style={{ padding: '8px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
            {'Selected'}: "{selectionRange.text.length > 40 ? selectionRange.text.slice(0, 40) + '...' : selectionRange.text}"
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              className="input-field"
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              placeholder={'Add comment...'}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              style={{ flex: 1, fontSize: 11 }}
            />
            <button className="primary-btn" onClick={handleAdd} disabled={!newComment.trim()} style={{ fontSize: 11 }}>
              {'Add'}
            </button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto' }}>
        {active.map(renderThread)}

        {resolved.length > 0 && (
          <>
            <div
              style={{
                padding: '6px 8px',
                fontSize: 11,
                color: 'var(--text-muted)',
                cursor: 'pointer',
                borderBottom: '1px solid var(--border)',
              }}
              onClick={() => setShowResolved(!showResolved)}
            >
              {showResolved ? '▾' : '▸'} {'Resolved'} ({resolved.length})
            </div>
            {showResolved && resolved.map(renderThread)}
          </>
        )}

        {active.length === 0 && resolved.length === 0 && (
          <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
            {'No comments. Select text in the editor to add a comment.'}
          </div>
        )}
      </div>
    </div>
  );
}
