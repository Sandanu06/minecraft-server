import { useEffect, useState } from 'react';
import { Check, Plus, ShieldCheck, Trash2, UserRound, X } from 'lucide-react';
import { api, markRestartNeeded } from '../api.js';
import { useApi } from '../hooks.js';
import { useMe } from '../App.jsx';
import { Confirm, Empty, Field, Modal, PageHead, Spinner, Tabs, useToast } from '../ui.jsx';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export default function Permissions() {
  const status = useApi('/lp/status');
  const me = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('groups');
  if (!status.data) return <div className="skeleton" style={{ height: 260 }} />;
  const s = status.data;

  if (!s.usable) {
    const setup = async () => { setBusy(true); try { await api('/lp/setup', { method: 'POST' }); markRestartNeeded(); toast('LuckPerms installed. Restart the server to start it.'); status.reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
    return (
      <div className="stack">
        <PageHead title="Permissions">Control what each group of players can do inside the game: ranks, commands and chat prefixes.</PageHead>
        <section className="panel"><Empty icon={ShieldCheck} title={s.installed ? 'LuckPerms is installed but not ready' : 'Set up in-game permissions'}>
          {s.installed && s.storage !== 'JSON' ? <span>LuckPerms is using {s.storage || 'its default'} storage. This page reads the JSON storage option, so it can show and edit everything live. Set <code>storage-method: JSON</code> in the LuckPerms config and restart.</span>
            : s.installed ? 'Restart the server so LuckPerms can start.' : 'This installs LuckPerms, the standard permissions plugin, configured so this dashboard can manage groups and players.'}
          {!s.installed && me.can('permissions.manage') && <button className="btn primary" disabled={busy} onClick={setup}>{busy && <Spinner />}Install LuckPerms</button>}
        </Empty></section>
      </div>
    );
  }
  return (
    <div className="stack">
      <PageHead title="Permissions">Control what each group of players can do inside the game. Changes apply instantly, with no restart.</PageHead>
      <Tabs value={tab} onChange={setTab} items={[['groups', 'Groups'], ['players', 'Players']]} />
      {tab === 'groups' ? <Groups suggestions={s.suggestions} can={me.can('permissions.manage')} /> : <PlayersTab can={me.can('permissions.manage')} />}
    </div>
  );
}

function Groups({ suggestions, can }) {
  const list = useApi('/lp/groups');
  const [sel, setSel] = useState('default');
  const detail = useApi(`/lp/groups/${sel}`, { enabled: !!sel });
  const toast = useToast();
  const [create, setCreate] = useState(null);
  const [del, setDel] = useState(null);
  const [perm, setPerm] = useState('');
  const [prefix, setPrefix] = useState(null);
  const [weight, setWeight] = useState(null);
  const d = detail.data;
  useEffect(() => { if (d) { setPrefix(d.prefix); setWeight(String(d.weight)); } }, [d?.name, d?.prefix, d?.weight]);

  const act = async (fn, msg) => { try { await fn(); await delay(500); if (msg) toast(msg); list.reload(); detail.reload(); } catch (e) { toast(e.message, 'err'); } };
  const post = (path, body) => api(path, { method: 'POST', body });

  return (
    <div className="split">
      <div className="stack-sm">
        <div className="role-list">{(list.data?.groups || []).map((g) => (
          <button key={g.name} className="role-btn" aria-pressed={sel === g.name} onClick={() => setSel(g.name)}>
            <span><b>{g.prefix ? <>{g.prefix.replace(/&./g, '')} </> : null}{g.name}</b><div className="muted" style={{ fontSize: 13 }}>weight {g.weight} · {g.members} {g.members === 1 ? 'player' : 'players'}</div></span><span className="muted num">{g.permissions}</span></button>))}</div>
        {can && <button className="btn" onClick={() => setCreate({ name: '', weight: '0' })}><Plus />New group</button>}
      </div>

      <section className="panel">
        {!d ? <div className="skeleton" style={{ height: 200, margin: 20 }} /> : <>
          <div className="panel-head"><div><h2>{d.name}</h2><div className="muted">Higher weight wins when groups disagree.</div></div>{can && d.name !== 'default' && <button className="btn small ghost danger" onClick={() => setDel(d.name)}><Trash2 />Delete</button>}</div>
          <div className="panel-pad" style={{ display: 'grid', gap: 18, alignItems: 'start', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            <Field label="Chat prefix" hint="Use & colour codes, for example &9[Mod]">{(id) => <div className="row"><input id={id} className="input" value={prefix ?? ''} disabled={!can} onChange={(e) => setPrefix(e.target.value)} />{can && prefix !== d.prefix && <button className="btn small primary" onClick={() => act(() => api(`/lp/groups/${d.name}`, { method: 'PUT', body: { prefix } }), 'Prefix saved')}>Save</button>}</div>}</Field>
            <Field label="Weight">{(id) => <div className="row"><input id={id} className="input" type="number" min={0} value={weight ?? ''} disabled={!can} onChange={(e) => setWeight(e.target.value)} />{can && weight !== String(d.weight) && <button className="btn small primary" onClick={() => act(() => api(`/lp/groups/${d.name}`, { method: 'PUT', body: { weight: Number(weight) } }), 'Weight saved')}>Save</button>}</div>}</Field>
          </div>
          <div className="perm-group"><h3>Inherits from</h3>
            <div className="chiprow">{d.parents.length === 0 && <span className="muted">Nothing</span>}{d.parents.map((p) => <span className="tag" key={p}>{p}{can && <button aria-label={`Remove ${p}`} onClick={() => act(() => post(`/lp/groups/${d.name}/parent`, { group: p, remove: true }), 'Removed')}><X size={13} /></button>}</span>)}
              {can && <select style={{ width: 160, minHeight: 32 }} value="" onChange={(e) => e.target.value && act(() => post(`/lp/groups/${d.name}/parent`, { group: e.target.value }), 'Added')} aria-label="Add a parent group"><option value="">Add parent…</option>{(list.data?.groups || []).filter((g) => g.name !== d.name && !d.parents.includes(g.name)).map((g) => <option key={g.name}>{g.name}</option>)}</select>}</div></div>
          <div className="perm-group"><h3>Permissions</h3>
            {can && <form className="row" onSubmit={(e) => { e.preventDefault(); if (perm) act(() => post(`/lp/groups/${d.name}/permission`, { permission: perm, value: true }), 'Allowed').then(() => setPerm('')); }}>
              <input className="input" list="lp-suggest" placeholder="minecraft.command.kick" value={perm} onChange={(e) => setPerm(e.target.value.trim())} aria-label="Permission" />
              <datalist id="lp-suggest">{suggestions.map(([n, t]) => <option key={n} value={n}>{t}</option>)}</datalist>
              <button className="btn primary" disabled={!perm}><Plus />Allow</button></form>}
            {d.permissions.length === 0 ? <div className="muted">No permissions set directly on this group.</div> : d.permissions.map((p) => (
              <div className="perm-row" key={p.permission + (p.context || '')}>
                <div className="t"><span className="mono">{p.permission}</span><small>{suggestions.find(([n]) => n === p.permission)?.[1] || ''}</small></div>
                <div className="row">
                  <span className={`pill ${p.value ? 'ok' : 'bad'}`}>{p.value ? <Check size={14} /> : <X size={14} />}{p.value ? 'Allowed' : 'Denied'}</span>
                  {can && <><button className="btn small" onClick={() => act(() => post(`/lp/groups/${d.name}/permission`, { permission: p.permission, value: !p.value }))}>{p.value ? 'Deny' : 'Allow'}</button>
                    <button className="btn small ghost danger" aria-label={`Remove ${p.permission}`} onClick={() => act(() => post(`/lp/groups/${d.name}/permission`, { permission: p.permission, unset: true }), 'Removed')}><Trash2 /></button></>}
                </div></div>))}</div>
          <div className="perm-group"><h3>Players in this group</h3>
            <div className="chiprow">{d.members.length === 0 ? <span className="muted">No one has been added directly.</span> : d.members.map((m) => <span className="tag" key={m.uuid}>{m.name}{can && <button aria-label={`Remove ${m.name}`} onClick={() => act(() => post(`/lp/users/${m.uuid}/group`, { group: d.name, action: 'remove' }), 'Removed')}><X size={13} /></button>}</span>)}</div></div>
        </>}
      </section>

      {create && <Modal title="New group" onClose={() => setCreate(null)} actions={<><button className="btn" onClick={() => setCreate(null)}>Cancel</button><button className="btn primary" disabled={!/^[a-z0-9_-]{1,32}$/.test(create.name)} onClick={async () => { await act(() => api('/lp/groups', { method: 'POST', body: { name: create.name, weight: Number(create.weight) || 0 } }), 'Group created'); setSel(create.name); setCreate(null); }}>Create group</button></>}>
        <Field label="Name" hint="Lowercase letters, numbers, dashes and underscores.">{(id) => <input id={id} className="input" value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value.toLowerCase() })} />}</Field>
        <Field label="Weight" hint="Higher weight wins when groups disagree.">{(id) => <input id={id} className="input" type="number" value={create.weight} onChange={(e) => setCreate({ ...create, weight: e.target.value })} />}</Field>
      </Modal>}
      {del && <Confirm title={`Delete ${del}?`} danger confirmLabel="Delete group" body="Players lose everything this group gave them." onClose={() => setDel(null)} onConfirm={async () => { await act(() => api(`/lp/groups/${del}`, { method: 'DELETE' }), 'Group deleted'); setSel('default'); setDel(null); }} />}
    </div>
  );
}

function PlayersTab({ can }) {
  const users = useApi('/lp/users');
  const groups = useApi('/lp/groups');
  const toast = useToast();
  const [q, setQ] = useState('');
  const act = async (fn, msg) => { try { await fn(); await delay(500); toast(msg); users.reload(); } catch (e) { toast(e.message, 'err'); } };
  const rows = (users.data?.users || []).filter((u) => u.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="stack">
      <input className="input" placeholder="Find a player" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a player" style={{ maxWidth: 360 }} />
      <section className="panel">
        {!users.data ? <div className="skeleton" style={{ height: 120, margin: 20 }} /> : rows.length === 0 ? <Empty icon={UserRound} title="No players yet">Players appear here after they first join.</Empty> : (
          <div className="list">{rows.map((u) => (
            <div className="item" key={u.uuid}>
              <img className="avatar head-skin" alt="" width="36" height="36" src={`https://mc-heads.net/avatar/${u.name}/72`} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
              <div className="grow"><div className="title">{u.name}</div><div className="chiprow" style={{ marginTop: 6 }}>{u.groups.map((g) => <span className="tag" key={g}>{g}{can && u.groups.length > 1 && <button aria-label={`Remove ${g}`} onClick={() => act(() => api(`/lp/users/${u.uuid}/group`, { method: 'POST', body: { group: g, action: 'remove' } }), 'Removed')}><X size={13} /></button>}</span>)}</div></div>
              {can && <select style={{ width: 170 }} value="" onChange={(e) => e.target.value && act(() => api(`/lp/users/${u.uuid}/group`, { method: 'POST', body: { group: e.target.value, action: 'add' } }), 'Group added')} aria-label={`Add ${u.name} to a group`}>
                <option value="">Add to group…</option>{(groups.data?.groups || []).filter((g) => !u.groups.includes(g.name)).map((g) => <option key={g.name}>{g.name}</option>)}</select>}
            </div>))}</div>)}
      </section>
    </div>
  );
}
