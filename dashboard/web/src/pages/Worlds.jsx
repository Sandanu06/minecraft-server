import { useState } from 'react';
import { Download, Globe2, Plus, Trash2, Zap } from 'lucide-react';
import { api, markRestartNeeded } from '../api.js';
import { useApi } from '../hooks.js';
import { ago, bytes } from '../format.js';
import { Confirm, Empty, Field, Modal, PageHead, useToast } from '../ui.jsx';

export default function Worlds() {
  const { data, reload } = useApi('/worlds', { every: 30000 });
  const toast = useToast();
  const [create, setCreate] = useState(null);
  const [remove, setRemove] = useState(null);
  const [activate, setActivate] = useState(null);

  const doActivate = async (body, msg) => {
    try { await api('/worlds/activate', { method: 'POST', body }); toast(msg); markRestartNeeded(); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="stack">
      <PageHead title="Worlds" actions={<button className="btn primary" onClick={() => setCreate({ name: '', seed: '' })}><Plus />New world</button>}>
        Your friends’ builds live in the active world. Switching worlds takes effect after a restart; no world is ever deleted from here.
      </PageHead>
      {data?.pendingNew && <div className="panel panel-pad row"><Zap color="var(--brand)" /><span>A new world called <b>{data.pendingNew}</b> will be generated at the next restart.</span></div>}
      <section className="panel">
        {!data ? <div className="skeleton" style={{ height: 140, margin: 20 }} /> : data.worlds.length === 0 ? <Empty icon={Globe2} title="No worlds found" /> : (
          <div className="list">{data.worlds.map((w) => (
            <div className="item" key={w.name}>
              <div className="avatar"><Globe2 size={18} /></div>
              <div className="grow">
                <div className="title">{w.name}{w.active && <span className="pill brand">Active</span>}</div>
                <div className="sub">{bytes(w.size)}{w.version ? ` · Minecraft ${w.version}` : ''}{w.lastPlayed ? ` · played ${ago(w.lastPlayed)}` : ''}</div>
              </div>
              <div className="actions">
                {!w.active && <button className="btn small" onClick={() => setActivate(w.name)}>Make active</button>}
                <a className="btn small" href={`/api/worlds/${w.name}/download`}><Download />Download</a>
                {!w.active && <button className="btn small ghost danger" onClick={() => setRemove(w.name)}><Trash2 />Remove</button>}
              </div>
            </div>))}</div>)}
      </section>

      {create && (
        <Modal title="New world" onClose={() => setCreate(null)} actions={<>
          <button className="btn" onClick={() => setCreate(null)}>Cancel</button>
          <button className="btn primary" disabled={!/^[A-Za-z0-9_-]{1,32}$/.test(create.name)} onClick={async () => { await doActivate({ name: create.name, seed: create.seed, create: true }, `${create.name} will be created on restart`); setCreate(null); }}>Create world</button></>}>
          <Field label="Name" hint="Letters, numbers, dashes and underscores.">{(id) => <input id={id} className="input" value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} maxLength={32} />}</Field>
          <Field label="Seed" hint="Leave empty for a random world.">{(id) => <input id={id} className="input" value={create.seed} onChange={(e) => setCreate({ ...create, seed: e.target.value })} maxLength={40} />}</Field>
          <div className="hint">The new world becomes the active one. Your current world stays on disk and you can switch back at any time.</div>
        </Modal>)}
      {activate && <Confirm title={`Switch to ${activate}?`} confirmLabel="Make active" body="Players will join this world after the next restart. The current world is kept." onClose={() => setActivate(null)}
        onConfirm={async () => { await doActivate({ name: activate }, `${activate} is active after restart`); setActivate(null); }} />}
      {remove && <Confirm title={`Remove ${remove}?`} danger typed={remove} confirmLabel="Move to trash" body="The world moves to a hidden trash folder on the server, so it can still be recovered by hand. It is not offered for play."
        onClose={() => setRemove(null)} onConfirm={async () => { try { await api(`/worlds/${remove}`, { method: 'DELETE' }); toast('World moved to trash'); reload(); } catch (e) { toast(e.message, 'err'); } setRemove(null); }} />}
    </div>
  );
}
