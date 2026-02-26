import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  gitStatus,
  gitInit,
  gitCommit,
  gitLog,
  gitDiff,
  gitBranch,
  gitCheckout,
  gitGetRemote,
  gitSetRemote,
  gitPush,
  gitPull,
} from '../../api/client';

interface GitChange {
  filepath: string;
  status: string;
}

interface GitCommitEntry {
  oid: string;
  message: string;
  author: string;
  email: string;
  timestamp: number;
}

interface DiffEntry {
  filepath: string;
  status: string;
  before: string;
  after: string;
}

interface GitPanelProps {
  projectId: string;
}

const STATUS_BADGES: Record<string, { label: string; color: string }> = {
  new: { label: 'N', color: '#22c55e' },
  added: { label: 'A', color: '#22c55e' },
  modified: { label: 'M', color: '#eab308' },
  deleted: { label: 'D', color: '#ef4444' },
  'added-modified': { label: 'AM', color: '#22c55e' },
  'modified-staged': { label: 'MS', color: '#eab308' },
};

export default function GitPanel({ projectId }: GitPanelProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'status' | 'history' | 'branches' | 'remote'>('status');
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [changes, setChanges] = useState<GitChange[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [commitMsg, setCommitMsg] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  // History tab
  const [commits, setCommits] = useState<GitCommitEntry[]>([]);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<DiffEntry[]>([]);

  // Branches tab
  const [newBranchName, setNewBranchName] = useState('');

  // Remote tab
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteUsername, setRemoteUsername] = useState('');
  const [remotePat, setRemotePat] = useState('');
  const [remoteBranch, setRemoteBranch] = useState('main');
  const [remoteHasToken, setRemoteHasToken] = useState(false);

  useEffect(() => {
    loadStatus();
  }, [projectId]);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const res = await gitStatus(projectId);
      if (res.ok) {
        setInitialized(res.initialized ?? false);
        setChanges(res.changes || []);
        setBranches(res.branches || []);
        setCurrentBranch(res.currentBranch || '');
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleInit = async () => {
    setBusy(true);
    try {
      const res = await gitInit(projectId);
      if (res.ok) {
        setStatus('Git initialized.');
        await loadStatus();
      } else {
        setStatus(res.error || 'Init failed.');
      }
    } catch (err: any) {
      setStatus(err.message);
    }
    setBusy(false);
  };

  const handleCommit = async () => {
    if (!commitMsg.trim()) {
      setStatus('Commit message required.');
      return;
    }
    setBusy(true);
    try {
      const res = await gitCommit(projectId, {
        message: commitMsg.trim(),
        authorName: authorName || undefined,
      });
      if (res.ok) {
        setStatus(`Committed: ${res.sha?.slice(0, 7)}`);
        setCommitMsg('');
        await loadStatus();
      } else {
        setStatus(res.error || 'Commit failed.');
      }
    } catch (err: any) {
      setStatus(err.message);
    }
    setBusy(false);
  };

  const loadHistory = async () => {
    try {
      const res = await gitLog(projectId);
      if (res.ok) setCommits(res.commits || []);
    } catch { /* ignore */ }
  };

  const viewDiff = async (oid: string, idx: number) => {
    if (idx >= commits.length - 1) return;
    const parentOid = commits[idx + 1]?.oid;
    if (!parentOid) return;
    setSelectedCommit(oid);
    try {
      const res = await gitDiff(projectId, { oid1: parentOid, oid2: oid });
      if (res.ok) setDiffs(res.diffs || []);
    } catch { /* ignore */ }
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    setBusy(true);
    try {
      const res = await gitBranch(projectId, { name: newBranchName.trim() });
      if (res.ok) {
        setNewBranchName('');
        setStatus(`Branch '${newBranchName.trim()}' created.`);
        await loadStatus();
      } else {
        setStatus(res.error || 'Failed.');
      }
    } catch (err: any) {
      setStatus(err.message);
    }
    setBusy(false);
  };

  const handleCheckout = async (name: string) => {
    setBusy(true);
    try {
      const res = await gitCheckout(projectId, { name });
      if (res.ok) {
        setStatus(`Switched to '${name}'.`);
        await loadStatus();
      } else {
        setStatus(res.error || 'Checkout failed.');
      }
    } catch (err: any) {
      setStatus(err.message);
    }
    setBusy(false);
  };

  const loadRemote = async () => {
    try {
      const res = await gitGetRemote(projectId);
      if (res.ok && res.remote) {
        setRemoteUrl(res.remote.url || '');
        setRemoteUsername(res.remote.username || '');
        setRemoteBranch(res.remote.branch || 'main');
        setRemoteHasToken(res.remote.hasToken || false);
      }
    } catch { /* ignore */ }
  };

  const saveRemote = async () => {
    setBusy(true);
    try {
      const res = await gitSetRemote(projectId, {
        url: remoteUrl,
        username: remoteUsername,
        token: remotePat || undefined,
        branch: remoteBranch,
      });
      if (res.ok) {
        setStatus('Remote saved.');
        setRemotePat('');
        setRemoteHasToken(true);
      } else {
        setStatus(res.error || 'Failed to save remote.');
      }
    } catch (err: any) {
      setStatus(err.message);
    }
    setBusy(false);
  };

  const handlePush = async () => {
    setBusy(true);
    setStatus('Pushing...');
    try {
      const res = await gitPush(projectId);
      setStatus(res.ok ? 'Push complete.' : (res.error || 'Push failed.'));
    } catch (err: any) {
      setStatus(err.message);
    }
    setBusy(false);
  };

  const handlePull = async () => {
    setBusy(true);
    setStatus('Pulling...');
    try {
      const res = await gitPull(projectId, { authorName });
      if (res.ok) {
        setStatus('Pull complete.');
        await loadStatus();
      } else {
        setStatus(res.error || 'Pull failed.');
      }
    } catch (err: any) {
      setStatus(err.message);
    }
    setBusy(false);
  };

  useEffect(() => {
    if (tab === 'history' && initialized) loadHistory();
    if (tab === 'remote' && initialized) loadRemote();
  }, [tab, initialized]);

  if (loading) {
    return <div className="git-panel" style={{ padding: 12 }}>{t('Loading...')}</div>;
  }

  return (
    <div className="git-panel">
      <div className="panel-header">
        <div>{t('Git')}{currentBranch ? ` (${currentBranch})` : ''}</div>
      </div>

      {!initialized ? (
        <div style={{ padding: 12, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>{t('Not a Git repository.')}</p>
          <button className="primary-btn" onClick={handleInit} disabled={busy} style={{ marginTop: 8 }}>
            {t('Initialize Git')}
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 4, padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
            {(['status', 'history', 'branches', 'remote'] as const).map(t2 => (
              <button
                key={t2}
                className={`tab-btn-sm ${tab === t2 ? 'active' : ''}`}
                onClick={() => setTab(t2)}
              >
                {t2.charAt(0).toUpperCase() + t2.slice(1)}
              </button>
            ))}
          </div>

          {tab === 'status' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div style={{ flex: 1, overflow: 'auto', padding: '4px 8px' }}>
                {changes.length === 0 ? (
                  <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
                    {t('Working tree clean.')}
                  </div>
                ) : (
                  changes.map(c => {
                    const badge = STATUS_BADGES[c.status] || { label: c.status.charAt(0).toUpperCase(), color: '#888' };
                    return (
                      <div key={c.filepath} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 12 }}>
                        <span style={{
                          background: badge.color,
                          color: '#fff',
                          borderRadius: 3,
                          padding: '0 4px',
                          fontSize: 10,
                          fontWeight: 600,
                          minWidth: 18,
                          textAlign: 'center',
                        }}>{badge.label}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.filepath}</span>
                      </div>
                    );
                  })
                )}
              </div>
              <div style={{ padding: '6px 8px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <input
                  className="input-field"
                  value={commitMsg}
                  onChange={e => setCommitMsg(e.target.value)}
                  placeholder={t('Commit message...')}
                  onKeyDown={e => e.key === 'Enter' && handleCommit()}
                />
                <button className="primary-btn" onClick={handleCommit} disabled={busy || !commitMsg.trim() || changes.length === 0}>
                  {t('Commit All')} ({changes.length})
                </button>
              </div>
            </div>
          )}

          {tab === 'history' && (
            <div style={{ flex: 1, overflow: 'auto', padding: '4px 8px' }}>
              {commits.map((c, idx) => (
                <div key={c.oid}>
                  <div
                    style={{
                      padding: '6px 0',
                      borderBottom: '1px solid var(--border)',
                      cursor: idx < commits.length - 1 ? 'pointer' : 'default',
                      fontSize: 12,
                    }}
                    onClick={() => viewDiff(c.oid, idx)}
                  >
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <code style={{ fontSize: 10, color: 'var(--accent)' }}>{c.oid.slice(0, 7)}</code>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.message}</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                      {c.author} &middot; {new Date(c.timestamp * 1000).toLocaleDateString()}
                    </div>
                  </div>
                  {selectedCommit === c.oid && diffs.length > 0 && (
                    <div style={{ padding: '4px 0 8px 12px', fontSize: 11 }}>
                      {diffs.map(d => (
                        <div key={d.filepath} style={{ marginBottom: 4 }}>
                          <div style={{ fontWeight: 500, color: d.status === 'added' ? '#22c55e' : d.status === 'deleted' ? '#ef4444' : '#eab308' }}>
                            {d.status === 'added' ? '+' : d.status === 'deleted' ? '-' : '~'} {d.filepath}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {commits.length === 0 && (
                <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
                  {t('No commits yet.')}
                </div>
              )}
            </div>
          )}

          {tab === 'branches' && (
            <div style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{t('Current')}: <strong>{currentBranch}</strong></div>
              </div>
              {branches.map(b => (
                <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', fontSize: 12 }}>
                  <span style={{ flex: 1 }}>{b === currentBranch ? `* ${b}` : b}</span>
                  {b !== currentBranch && (
                    <button className="small-btn" onClick={() => handleCheckout(b)} disabled={busy} style={{ fontSize: 10 }}>
                      {t('Checkout')}
                    </button>
                  )}
                </div>
              ))}
              <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                <input
                  className="input-field"
                  value={newBranchName}
                  onChange={e => setNewBranchName(e.target.value)}
                  placeholder={t('New branch name...')}
                  style={{ flex: 1 }}
                />
                <button className="primary-btn" onClick={handleCreateBranch} disabled={busy || !newBranchName.trim()}>
                  {t('Create')}
                </button>
              </div>
            </div>
          )}

          {tab === 'remote' && (
            <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 11 }}>{t('Remote URL')}</label>
              <input
                className="input-field"
                value={remoteUrl}
                onChange={e => setRemoteUrl(e.target.value)}
                placeholder="https://github.com/user/repo.git"
              />
              <label style={{ fontSize: 11 }}>{t('Username')}</label>
              <input
                className="input-field"
                value={remoteUsername}
                onChange={e => setRemoteUsername(e.target.value)}
                placeholder="github-username"
              />
              <label style={{ fontSize: 11 }}>{t('Personal Access Token')}</label>
              <input
                className="input-field"
                type="password"
                value={remotePat}
                onChange={e => setRemotePat(e.target.value)}
                placeholder={remoteHasToken ? '(saved)' : 'ghp_...'}
              />
              <label style={{ fontSize: 11 }}>{t('Branch')}</label>
              <input
                className="input-field"
                value={remoteBranch}
                onChange={e => setRemoteBranch(e.target.value)}
                placeholder="main"
              />
              <button className="primary-btn" onClick={saveRemote} disabled={busy}>
                {t('Save Remote')}
              </button>
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <button className="primary-btn" onClick={handlePush} disabled={busy} style={{ flex: 1 }}>
                  {t('Push')}
                </button>
                <button className="primary-btn" onClick={handlePull} disabled={busy} style={{ flex: 1 }}>
                  {t('Pull')}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {status && (
        <div style={{ padding: '4px 8px', fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
          {status}
        </div>
      )}
    </div>
  );
}
