import { useState } from 'react';
import { Ban, Check, Gift, MapPin, MessageSquare, Shield, ShieldOff, SlidersHorizontal, UserMinus, UserPlus, UserX, Users as UsersIcon } from 'lucide-react';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { useMe } from '../App.jsx';
import { ago, seconds } from '../format.js';
import { Confirm, Empty, Field, Modal, PageHead, Tabs, Toggle, useToast } from '../ui.jsx';

const Avatar = ({ name }) => <img className="avatar head-skin" alt="" width="36" height="36" src={`https://mc-heads.net/avatar/${name}/72`} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />;

export default function Players() {
  const { data, reload, error } = useApi('/players', { every: 10000 });
  const me = useMe();
  const [tab, setTab] = useState('all');
  const [name, setName] = useState('');
  const [ban, setBan] = useState(null);
  const [ctl, setCtl] = useState(null);
  const [reason, setReason] = useState('');
  const toast = useToast();
  const moderate = me.can('players.moderate'), op = me.can('players.op'), control = me.can('players.control');

  const run = async (action, who, extra = {}, msg) => {
    try { await api(`/players/${action}`, { method: 'POST', body: { name: who, ...extra } }); toast(msg || 'Done'); reload(); }
    catch (e) { toast(e.message, 'err'); }
  };
  if (error && !data) return <div className="stack"><PageHead title="Players" /><div className="panel"><Empty icon={UsersIcon} title="Players are unavailable">{error.message}</Empty></div></div>;
  if (!data) return <div className="skeleton" style={{ height: 320 }} />;

  const all = data.known;
  const rows = tab === 'online' ? all.filter((p) => p.online) : tab === 'whitelist' ? data.whitelist.map((w) => ({ name: w.name, whitelisted: true, op: data.ops.some((o) => o.name === w.name) })) : tab === 'bans' ? data.bans.map((b) => ({ name: b.name, banned: true, reason: b.reason, created: b.created })) : all;

  return (
    <div className="stack">
      <PageHead title="Players" actions={moderate &&
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (name) run('whitelist-add', name, {}, `${name} can now join`).then(() => setName('')); }}>
          <input className="input" style={{ width: 200 }} placeholder="Player name" value={name} onChange={(e) => setName(e.target.value)} maxLength={16} aria-label="Player name" />
          <button className="btn primary" disabled={!name}><UserPlus />Allow</button>
        </form>}>
        {data.online.online} of {data.maxPlayers} slots in use. {data.whitelistEnabled ? 'Only allowed players can join.' : 'Anyone can join.'}
      </PageHead>

      <div className="panel panel-pad row spread wrap">
        <div><h3>Allowlist</h3><div className="muted">When on, only players on the list can join. Recommended once your friend group is set.</div></div>
        <Toggle label="Allowlist" checked={data.whitelistEnabled} disabled={!moderate} onChange={async (on) => { try { await api('/whitelist/enabled', { method: 'POST', body: { on } }); toast(on ? 'Allowlist on' : 'Allowlist off'); reload(); } catch (e) { toast(e.message, 'err'); } }} />
      </div>

      <Tabs value={tab} onChange={setTab} items={[['all', `Known (${all.length})`], ['online', `Online (${data.online.online})`], ['whitelist', `Allowed (${data.whitelist.length})`], ['bans', `Banned (${data.bans.length})`]]} />

      <section className="panel">
        {rows.length === 0 ? <Empty icon={UsersIcon} title="Nobody here yet">{tab === 'bans' ? 'No one is banned.' : 'Players appear after they join the server.'}</Empty> : (
          <div className="list">{rows.map((p) => (
            <div className="item" key={p.name}>
              <Avatar name={p.name} />
              <div className="grow">
                <div className="title">{p.name}
                  {p.online && <span className="pill ok"><i className="dot" />Online</span>}
                  {p.op && <span className="pill brand">Operator</span>}
                  {p.banned && <span className="pill bad">Banned</span>}
                </div>
                <div className="sub">{p.banned ? p.reason : [p.playSeconds != null ? `${seconds(p.playSeconds)} played` : null, p.lastSeen && !p.online ? `last seen ${ago(new Date(p.lastSeen))}` : null, p.joins ? `${p.joins} visit${p.joins === 1 ? '' : 's'} since tracking began` : null].filter(Boolean).join(' · ') || p.uuid || ''}</div>
              </div>
              <div className="actions">
                {p.banned ? (moderate && <button className="btn small" onClick={() => run('pardon', p.name, {}, `${p.name} was unbanned`)}><Check />Unban</button>) : <>
                  {control && p.online && <button className="btn small primary" onClick={() => setCtl(p.name)}><SlidersHorizontal />Controls</button>}
                  {op && (p.op ? <button className="btn small" onClick={() => run('deop', p.name, {}, `${p.name} is no longer an operator`)}><ShieldOff />Remove operator</button>
                    : <button className="btn small" onClick={() => run('op', p.name, {}, `${p.name} is now an operator`)}><Shield />Make operator</button>)}
                  {moderate && (p.whitelisted ? <button className="btn small" onClick={() => run('whitelist-remove', p.name, {}, `${p.name} removed from the allowlist`)}><UserMinus />Remove access</button>
                    : <button className="btn small" onClick={() => run('whitelist-add', p.name, {}, `${p.name} can now join`)}><UserPlus />Allow</button>)}
                  {moderate && p.online && <button className="btn small" onClick={() => run('kick', p.name, {}, `${p.name} was kicked`)}><UserX />Kick</button>}
                  {moderate && <button className="btn small danger" onClick={() => { setBan(p.name); setReason(''); }}><Ban />Ban</button>}
                </>}
              </div>
            </div>))}
          </div>
        )}
      </section>

      {ban && (
        <Confirm title={`Ban ${ban}?`} danger confirmLabel="Ban player" onClose={() => setBan(null)}
          body={<div className="stack-sm"><div>They are removed immediately and cannot rejoin until unbanned.</div>
            <input className="input" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} /></div>}
          onConfirm={async () => { await run('ban', ban, { reason }, `${ban} was banned`); setBan(null); }} />
      )}
      {ctl && <PlayerControls name={ctl} others={data.online.names.filter((n) => n !== ctl)} onClose={() => setCtl(null)} />}
    </div>
  );
}

function PlayerControls({ name, others, onClose }) {
  const toast = useToast();
  const [mode, setMode] = useState('survival');
  const [target, setTarget] = useState(others[0] || '');
  const [xyz, setXyz] = useState({ x: '', y: '', z: '' });
  const [item, setItem] = useState('diamond');
  const [count, setCount] = useState('1');
  const [text, setText] = useState('');
  const go = async (action, body = {}, msg) => {
    try { const r = await api(`/player-control/${name}/${action}`, { method: 'POST', body }); toast(msg || r.output || 'Done'); }
    catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Modal wide title={`Controls for ${name}`} onClose={onClose} actions={<button className="btn primary" onClick={onClose}>Close</button>}>
      <div className="stack">
        <div className="row wrap"><Field label="Game mode">{(id) => <select id={id} value={mode} onChange={(e) => setMode(e.target.value)}>{['survival', 'creative', 'adventure', 'spectator'].map((m) => <option key={m}>{m}</option>)}</select>}</Field>
          <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => go('gamemode', { mode }, `${name} is now in ${mode}`)}>Apply</button></div>
        <div className="quick">
          <button className="btn small" onClick={() => go('heal', {}, 'Healed')}>Heal</button>
          <button className="btn small" onClick={() => go('feed', {}, 'Fed')}>Feed</button>
          <button className="btn small danger" onClick={() => go('clear', {}, 'Inventory cleared')}>Clear inventory</button>
          <button className="btn small danger" onClick={() => go('kill', {}, `${name} was killed`)}>Kill</button>
        </div>
        <div className="stack-sm"><h3><MapPin size={16} style={{ verticalAlign: -2 }} /> Teleport</h3>
          <div className="row wrap">
            <select style={{ width: 200 }} value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Teleport to player" disabled={!others.length}>{others.length ? others.map((o) => <option key={o}>{o}</option>) : <option>No one else online</option>}</select>
            <button className="btn" disabled={!target} onClick={() => go('teleport-to', { target }, `Teleported to ${target}`)}>Go to player</button></div>
          <div className="row wrap">{['x', 'y', 'z'].map((k) => <input key={k} className="input" style={{ width: 100 }} placeholder={k.toUpperCase()} aria-label={k.toUpperCase()} value={xyz[k]} onChange={(e) => setXyz({ ...xyz, [k]: e.target.value })} />)}
            <button className="btn" disabled={!xyz.x || !xyz.y || !xyz.z} onClick={() => go('teleport-xyz', xyz, 'Teleported')}>Go to coordinates</button></div></div>
        <div className="stack-sm"><h3><Gift size={16} style={{ verticalAlign: -2 }} /> Give an item</h3>
          <div className="row wrap"><input className="input" style={{ width: 220 }} value={item} onChange={(e) => setItem(e.target.value.trim())} aria-label="Item" placeholder="diamond or minecraft:oak_log" />
            <input className="input" style={{ width: 90 }} type="number" min={1} max={2304} value={count} onChange={(e) => setCount(e.target.value)} aria-label="Amount" />
            <button className="btn" disabled={!item} onClick={() => go('give', { item, count: Number(count) }, `Gave ${count} ${item}`)}>Give</button></div></div>
        <div className="stack-sm"><h3><MessageSquare size={16} style={{ verticalAlign: -2 }} /> Private message</h3>
          <div className="row"><input className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} aria-label="Message" placeholder="Say something to just them" />
            <button className="btn" disabled={!text.trim()} onClick={() => go('message', { text }, 'Sent').then(() => setText(''))}>Send</button></div></div>
      </div>
    </Modal>
  );
}
