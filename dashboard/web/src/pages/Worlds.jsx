import { useState } from 'react';
import { Download, Globe2, Plus, Trash2, Zap } from 'lucide-react';
import { api, markRestartNeeded } from '../api.js';
import { useApi } from '../hooks.js';
import { ago, bytes } from '../format.js';
import { useMe } from '../App.jsx';
import { Confirm, Empty, Field, Modal, PageHead, Toggle, useToast } from '../ui.jsx';
import { CloudRain, Moon, Save, Sun, Sunrise, Sunset, Zap as Bolt } from 'lucide-react';

function GameControls() {
  const { data, reload, error } = useApi('/world-control', { every: 20000 });
  const me = useMe();
  const toast = useToast();
  const [border, setBorder] = useState('');
  const canDo = me.can('world.control');
  const go = async (path, body, msg) => { try { await api(`/world-control/${path}`, { method: 'POST', body }); toast(msg); reload(); } catch (e) { toast(e.message, 'err'); } };
  if (error) return <section className="panel panel-pad muted">Game controls need the server to be online. {error.message}</section>;
  if (!data) return <div className="skeleton" style={{ height: 160 }} />;
  const hours = data.daytime != null ? Math.floor(((data.daytime + 6000) % 24000) / 1000) : null;
  return (
    <section className="panel">
      <div className="panel-head"><div><h2>Game controls</h2><div className="muted">Change the world live. No restart needed.</div></div>
        <button className="btn small" disabled={!canDo} onClick={() => go('save', {}, 'World saved')}><Save />Save now</button></div>
      <div className="panel-pad stack">
        <div className="stack-sm"><div className="label">Time{hours != null ? ` · about ${String(hours).padStart(2, '0')}:00 in game` : ''}</div>
          <div className="quick">{[['day', Sunrise, 'Day'], ['noon', Sun, 'Noon'], ['night', Sunset, 'Night'], ['midnight', Moon, 'Midnight']].map(([v, Icon, l]) => <button key={v} className="btn small" disabled={!canDo} onClick={() => go('time', { value: v }, `Time set to ${l.toLowerCase()}`)}><Icon />{l}</button>)}</div></div>
        <div className="stack-sm"><div className="label">Weather</div>
          <div className="quick">{[['clear', Sun, 'Clear'], ['rain', CloudRain, 'Rain'], ['thunder', Bolt, 'Thunder']].map(([v, Icon, l]) => <button key={v} className="btn small" disabled={!canDo} onClick={() => go('weather', { kind: v }, `Weather: ${l.toLowerCase()}`)}><Icon />{l}</button>)}</div></div>
        <div className="row wrap">
          <Field label="Difficulty">{(id) => <select id={id} style={{ width: 170 }} value={(data.difficulty || '').toLowerCase()} disabled={!canDo} onChange={(e) => go('difficulty', { value: e.target.value }, `Difficulty: ${e.target.value}`)}>{['peaceful', 'easy', 'normal', 'hard'].map((d) => <option key={d}>{d}</option>)}</select>}</Field>
          <Field label="World border (blocks wide)">{(id) => <div className="row"><input id={id} className="input" style={{ width: 160 }} type="number" min={1} placeholder={String(Math.round(data.worldBorder))} value={border} disabled={!canDo} onChange={(e) => setBorder(e.target.value)} /><button className="btn small" disabled={!canDo || !border} onClick={() => go('worldborder', { size: Number(border) }, 'World border set').then(() => setBorder(''))}>Set</button></div>}</Field>
        </div>
      </div>
      <div className="perm-group"><h3>Game rules</h3>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {data.gamerules.map((r) => (
            <div className="perm-row" key={r.name}>
              <div className="t">{r.label}<small className="mono">{r.name}</small></div>
              {r.kind === 'bool' ? <Toggle checked={r.value === 'true'} label={r.label} disabled={!canDo} onChange={(v) => go('gamerule', { name: r.name, value: v }, `${r.label}: ${v ? 'on' : 'off'}`)} />
                : <input className="input" style={{ width: 90 }} type="number" defaultValue={r.value} disabled={!canDo} onBlur={(e) => e.target.value !== r.value && go('gamerule', { name: r.name, value: Number(e.target.value) }, `${r.label} updated`)} aria-label={r.label} />}
            </div>))}
        </div>
      </div>
    </section>
  );
}

export default function Worlds() {
  const me = useMe();
  const manage = me.can('worlds.manage');
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
      <PageHead title="Worlds" actions={manage && <button className="btn primary" onClick={() => setCreate({ name: '', seed: '' })}><Plus />New world</button>}>
        Your friends’ builds live in the active world. Switching worlds takes effect after a restart; no world is ever deleted from here.
      </PageHead>
      {data?.pendingNew && <div className="panel panel-pad row"><Zap color="var(--brand)" /><span>A new world called <b>{data.pendingNew}</b> will be generated at the next restart.</span></div>}
      {me.can('worlds.view') && <GameControls />}
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
                {manage && !w.active && <button className="btn small" onClick={() => setActivate(w.name)}>Make active</button>}
                {manage && <a className="btn small" href={`/api/worlds/${w.name}/download`}><Download />Download</a>}
                {manage && !w.active && <button className="btn small ghost danger" onClick={() => setRemove(w.name)}><Trash2 />Remove</button>}
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
