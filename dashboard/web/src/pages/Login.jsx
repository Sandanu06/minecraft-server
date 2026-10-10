import { useState } from 'react';
import { api } from '../api.js';
import { Logo, Spinner } from '../ui.jsx';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api('/login', { method: 'POST', body: { username, password, code: code || undefined } }); await onLogin(); }
    catch (err) {
      if (err.data?.needCode) { setNeedCode(true); setError(code ? err.message : ''); } else setError(err.message);
    } finally { setBusy(false); }
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
          <div><h2 style={{ fontSize: 24 }}>{needCode ? 'Two-step check' : 'Sign in'}</h2><p className="muted" style={{ marginTop: 4 }}>{needCode ? 'Enter the 6-digit code from your authenticator app.' : 'Team access only.'}</p></div>
          {!needCode && <>
            <div className="field"><label htmlFor="u">Username</label><input id="u" className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required /></div>
            <div className="field"><label htmlFor="p">Password</label><input id="p" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></div>
          </>}
          {needCode && <div className="field"><label htmlFor="c">Code</label><input id="c" className="input mono" inputMode="numeric" pattern="[0-9 ]*" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" autoFocus required style={{ letterSpacing: '.3em', fontSize: 20 }} /></div>}
          {error && <div className="err-text" role="alert">{error}</div>}
          <button className="btn primary" disabled={busy}>{busy && <Spinner />}{needCode ? 'Verify' : 'Sign in'}</button>
          {needCode && <button type="button" className="btn ghost" onClick={() => { setNeedCode(false); setCode(''); setError(''); }}>Back</button>}
        </form>
      </section>
    </div>
  );
}
