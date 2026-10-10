import { useState } from 'react';
import { KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import { api } from '../api.js';
import { useMe } from '../App.jsx';
import { useApi } from '../hooks.js';
import { Confirm, Field, Modal, PageHead, Spinner, useToast } from '../ui.jsx';

export default function Account({ onSignedOut }) {
  const me = useMe();
  const toast = useToast();
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [off, setOff] = useState(false);
  const [pw, setPw] = useState('');
  const ok = f.current && f.next.length >= 10 && f.next === f.again;

  const change = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api('/account/password', { method: 'POST', body: { current: f.current, next: f.next } }); toast('Password changed. Please sign in again.'); setTimeout(onSignedOut, 900); }
    catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };
  const start2fa = async () => { try { setSetup(await api('/account/totp/setup', { method: 'POST' })); setCode(''); } catch (e) { toast(e.message, 'err'); } };
  const enable = async () => {
    try { await api('/account/totp/enable', { method: 'POST', body: { code } }); toast('Two-step sign-in is on'); setSetup(null); location.reload(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const disable = async () => {
    try { await api('/account/totp/disable', { method: 'POST', body: { password: pw } }); toast('Two-step sign-in is off'); setOff(false); location.reload(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const groups = {};
  for (const p of me.permissions) (groups[p.split('.')[0]] ||= []).push(p);

  return (
    <div className="stack">
      <PageHead title="Account">Signed in as <b>{me.user}</b> · role <b>{me.roleName}</b></PageHead>

      <section className="panel">
        <div className="panel-head"><div className="row"><Smartphone /><div><h2>Two-step sign-in</h2><div className="muted">Ask for a code from an authenticator app (Google Authenticator, 1Password, Authy) after the password.</div></div></div>
          {me.totp ? <button className="btn danger" onClick={() => { setOff(true); setPw(''); }}>Turn off</button> : <button className="btn primary" onClick={start2fa}>Set up</button>}</div>
        <div className="panel-pad">{me.totp ? <span className="pill ok"><ShieldCheck size={15} />On</span> : <span className="muted">Off. Recommended, because this dashboard can control your server.</span>}</div>
      </section>

      <form className="panel" onSubmit={change}>
        <div className="panel-head"><div className="row"><KeyRound /><h2>Change password</h2></div><button className="btn small" disabled={!ok || busy}>{busy && <Spinner />}Change password</button></div>
        <div className="panel-pad" style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          <Field label="Current password">{(id) => <input id={id} className="input" type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />}</Field>
          <Field label="New password" hint="At least 10 characters.">{(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />}</Field>
          <Field label="Repeat new password">{(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} />}</Field>
        </div>
      </form>

      <section className="panel panel-pad stack-sm">
        <h2>What your role allows</h2>
        <div className="muted">Ask an owner if you need more access.</div>
        <div className="chiprow">{me.permissions.map((p) => <span key={p} className="pill mono">{p}</span>)}</div>
      </section>

      {setup && (
        <Modal title="Set up two-step sign-in" onClose={() => setSetup(null)} actions={<><button className="btn" onClick={() => setSetup(null)}>Cancel</button><button className="btn primary" disabled={code.replace(/\s/g, '').length !== 6} onClick={enable}>Turn on</button></>}>
          <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div className="qr" dangerouslySetInnerHTML={{ __html: setup.qr }} />
            <div className="stack-sm" style={{ flex: 1, minWidth: 200 }}>
              <div>1. Scan this code with your authenticator app.</div>
              <div className="hint">Cannot scan? Enter this key instead:</div><div className="secret">{setup.secret}</div>
              <div style={{ marginTop: 6 }}>2. Type the 6-digit code it shows.</div>
              <input className="input mono" inputMode="numeric" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" style={{ letterSpacing: '.2em' }} />
            </div>
          </div>
        </Modal>
      )}
      {off && (
        <Modal title="Turn off two-step sign-in?" onClose={() => setOff(false)} actions={<><button className="btn" onClick={() => setOff(false)}>Cancel</button><button className="btn danger solid" disabled={!pw} onClick={disable}>Turn off</button></>}>
          <Field label="Confirm with your password">{(id) => <input id={id} className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />}</Field>
        </Modal>
      )}
    </div>
  );
}
