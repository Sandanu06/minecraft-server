import { useState } from 'react';
import { api } from '../api.js';
import { Logo, Spinner } from '../ui.jsx';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { const r = await api('/login', { method: 'POST', body: { username, password } }); onLogin(r.user); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <section className="login-brand">
        <Logo className="login-mark" />
        <div>
          <h1>Run your world from one place.</h1>
          <p>Start and stop the server, manage players and plugins, and keep every world backed up.</p>
        </div>
        <span className="faint" style={{ fontSize: 13 }}>Teczos Minecraft</span>
      </section>
      <section className="login-form">
        <form className="login-card" onSubmit={submit}>
          <div><h2 style={{ fontSize: 24 }}>Sign in</h2><p className="muted" style={{ marginTop: 4 }}>Admin access only.</p></div>
          <div className="field"><label htmlFor="u">Username</label><input id="u" className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required /></div>
          <div className="field"><label htmlFor="p">Password</label><input id="p" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></div>
          {error && <div className="err-text" role="alert">{error}</div>}
          <button className="btn primary" disabled={busy}>{busy && <Spinner />}Sign in</button>
        </form>
      </section>
    </div>
  );
}
