import { useState } from 'react';
import { Ban, Check, Shield, ShieldOff, UserMinus, UserPlus, UserX, Users as UsersIcon } from 'lucide-react';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { seconds } from '../format.js';
import { Confirm, Empty, Modal, PageHead, Tabs, Toggle, useToast } from '../ui.jsx';

const Avatar = ({ name }) => <img className="avatar head-skin" alt="" width="36" height="36" src={`https://mc-heads.net/avatar/${name}/72`} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />;

export default function Players() {
  const { data, reload, error } = useApi('/players', { every: 10000 });
  const [tab, setTab] = useState('all');
  const [name, setName] = useState('');
  const [ban, setBan] = useState(null);
  const [reason, setReason] = useState('');
  const toast = useToast();

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
      <PageHead title="Players" actions={
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (name) run('whitelist-add', name, {}, `${name} can now join`).then(() => setName('')); }}>
          <input className="input" style={{ width: 200 }} placeholder="Player name" value={name} onChange={(e) => setName(e.target.value)} maxLength={16} aria-label="Player name" />
          <button className="btn primary" disabled={!name}><UserPlus />Allow</button>
        </form>}>
        {data.online.online} of {data.maxPlayers} slots in use. {data.whitelistEnabled ? 'Only allowed players can join.' : 'Anyone can join.'}
      </PageHead>

      <div className="panel panel-pad row spread wrap">
        <div><h3>Allowlist</h3><div className="muted">When on, only players on the list can join. Recommended once your friend group is set.</div></div>
        <Toggle label="Allowlist" checked={data.whitelistEnabled} onChange={async (on) => { try { await api('/whitelist/enabled', { method: 'POST', body: { on } }); toast(on ? 'Allowlist on' : 'Allowlist off'); reload(); } catch (e) { toast(e.message, 'err'); } }} />
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
                <div className="sub">{p.banned ? p.reason : p.playSeconds != null ? `${seconds(p.playSeconds)} played` : p.uuid || ''}</div>
              </div>
              <div className="actions">
                {p.banned ? <button className="btn small" onClick={() => run('pardon', p.name, {}, `${p.name} was unbanned`)}><Check />Unban</button> : <>
                  {p.op ? <button className="btn small" onClick={() => run('deop', p.name, {}, `${p.name} is no longer an operator`)}><ShieldOff />Remove operator</button>
                    : <button className="btn small" onClick={() => run('op', p.name, {}, `${p.name} is now an operator`)}><Shield />Make operator</button>}
                  {p.whitelisted ? <button className="btn small" onClick={() => run('whitelist-remove', p.name, {}, `${p.name} removed from the allowlist`)}><UserMinus />Remove access</button>
                    : <button className="btn small" onClick={() => run('whitelist-add', p.name, {}, `${p.name} can now join`)}><UserPlus />Allow</button>}
                  {p.online && <button className="btn small" onClick={() => run('kick', p.name, {}, `${p.name} was kicked`)}><UserX />Kick</button>}
                  <button className="btn small danger" onClick={() => { setBan(p.name); setReason(''); }}><Ban />Ban</button>
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
    </div>
  );
}
