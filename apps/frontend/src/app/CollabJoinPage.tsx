import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveCollabToken, setCollabServer, setCollabToken } from '../api/client';

export default function CollabJoinPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('Joining collaboration...');

  useEffect(() => { document.title = `${'Join Collaboration'} — Manuscripta`; }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') || '';
    if (!token) {
      setStatus('Invite link missing token.');
      return;
    }
    setCollabServer(window.location.origin);
    setStatus('Validating invite...');
    resolveCollabToken(token)
      .then((res) => {
        if (!res.ok || !res.projectId) {
          setStatus('Invite is invalid or expired.');
          return;
        }
        setCollabToken(token);
        setStatus('Joined. Opening project...');
        navigate(`/editor/${res.projectId}`, { replace: true });
      })
      .catch((err) => {
        setStatus(`Join failed: ${error}`);
      });
  }, [navigate]);

  return (
    <div className="collab-join">
      <div className="panel collab-join-card">
        <div className="panel-header">{'Join Collaboration'}</div>
        <div className="collab-join-body">
          <div className="muted">{status}</div>
        </div>
      </div>
    </div>
  );
}
