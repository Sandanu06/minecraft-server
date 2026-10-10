import { useState } from 'react';
import { Bell, Send } from 'lucide-react';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { Field, PageHead, Spinner, Toggle, useToast } from '../ui.jsx';

export default function Alerts() {
  const { data, reload } = useApi('/alerts');
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState('');
  if (!data) return <div className="skeleton" style={{ height: 300 }} />;

  const save = async (body, msg) => { setBusy('save'); try { await api('/alerts', { method: 'PUT', body }); toast(msg || 'Saved'); setUrl(''); reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); } };
  const test = async () => { setBusy('test'); try { await api('/alerts/test', { method: 'POST' }); toast('Test message sent'); } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); } };

  return (
    <div className="stack">
      <PageHead title="Alerts">Get a message in Discord when something happens on the server, so you do not have to keep this page open.</PageHead>
      <section className="panel">
        <div className="panel-head"><div className="row"><Bell /><div><h2>Discord webhook</h2><div className="muted">Channel settings → Integrations → Webhooks → New webhook → Copy URL.</div></div></div>
          {data.urlSet && <span className="pill ok">Connected · {data.urlHint}</span>}</div>
        <div className="panel-pad row wrap" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 260 }}><Field label={data.urlSet ? 'Replace the webhook address' : 'Webhook address'}>{(id) => <input id={id} className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/…" autoComplete="off" />}</Field></div>
          <button className="btn primary" disabled={!url || busy === 'save'} onClick={() => save({ url }, 'Webhook saved')}>{busy === 'save' && <Spinner />}Save</button>
          <button className="btn" disabled={!data.urlSet || busy === 'test'} onClick={test}>{busy === 'test' ? <Spinner /> : <Send />}Send test</button>
          {data.urlSet && <button className="btn ghost danger" onClick={() => save({ clear: true }, 'Webhook removed')}>Remove</button>}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>What to tell me about</h2></div>
        {Object.entries(data.labels).map(([key, label]) => (
          <div className="switchrow" key={key}><span>{label}</span><Toggle checked={!!data.events[key]} label={label} disabled={!data.urlSet} onChange={(v) => save({ events: { [key]: v } })} /></div>))}
      </section>
    </div>
  );
}
