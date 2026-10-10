import { useEffect, useMemo, useState } from 'react';
import { Copy, KeyRound, Plus, ShieldAlert, ShieldCheck, Trash2, UserCog, UserPlus } from 'lucide-react';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { useMe } from '../App.jsx';
import { ago } from '../format.js';
import { Confirm, Empty, Field, Modal, PageHead, Spinner, Tabs, Toggle, useToast } from '../ui.jsx';

export default function Access() {
  const [tab, setTab] = useState('users');
  return (
    <div className="stack">
      <PageHead title="Access">Who can sign in to this dashboard, and what each role is allowed to do. Changes apply immediately.</PageHead>
      <Tabs value={tab} onChange={setTab} items={[['users', 'People'], ['roles', 'Roles and permissions']]} />
      {tab === 'users' ? <UsersTab /> : <RolesTab />}
    </div>
  );
}

function UsersTab() {
  const { data, reload } = useApi('/users');
  const me = useMe();
  const toast = useToast();
  const [create, setCreate] = useState(null);
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [secret, setSecret] = useState(null);
  const roles = data?.roles || [];

  const act = async (fn, msg) => { try { const r = await fn(); if (msg) toast(msg); reload(); return r; } catch (e) { toast(e.message, 'err'); } };
  const copy = async (t) => { try { await navigator.clipboard.writeText(t); toast('Copied'); } catch { toast('Copy failed', 'err'); } };

  return (
    <>
      <div className="row spread"><span className="muted">{data ? `${data.users.length} ${data.users.length === 1 ? 'person' : 'people'}` : ''}</span>
        <button className="btn primary" onClick={() => setCreate({ username: '', role: 'moderator', password: '' })}><UserPlus />Add person</button></div>
      <section className="panel">
        {!data ? <div className="skeleton" style={{ height: 120, margin: 20 }} /> : (
          <div className="list">{data.users.map((u) => (
            <div className="item" key={u.id} style={{ opacity: u.disabled ? .55 : 1 }}>
              <div className="avatar">{u.username[0].toUpperCase()}</div>
              <div className="grow">
                <div className="title">{u.username}{u.id === me.id && <span className="pill">You</span>}<span className="pill brand">{u.roleName}</span>
                  {u.totp ? <span className="pill ok"><ShieldCheck size={14} />2-step</span> : <span className="pill warn"><ShieldAlert size={14} />No 2-step</span>}{u.disabled && <span className="pill bad">Disabled</span>}</div>
                <div className="sub">{u.lastLoginAt ? `Last signed in ${ago(u.lastLoginAt)}` : 'Never signed in'}</div>
              </div>
              {u.id !== me.id && <div className="actions">
                <button className="btn small" onClick={() => setEdit({ ...u })}><UserCog />Change role</button>
                <button className="btn small" onClick={() => act(async () => { const r = await api(`/users/${u.id}/reset-password`, { method: 'POST', body: {} }); setSecret({ title: `New password for ${u.username}`, value: r.password }); }, '')}><KeyRound />Reset password</button>
                {u.totp && <button className="btn small" onClick={() => act(() => api(`/users/${u.id}/reset-2fa`, { method: 'POST' }), 'Two-step sign-in reset')}>Reset 2-step</button>}
                <button className="btn small" onClick={() => act(() => api(`/users/${u.id}`, { method: 'PATCH', body: { disabled: !u.disabled } }), u.disabled ? 'Account enabled' : 'Account disabled')}>{u.disabled ? 'Enable' : 'Disable'}</button>
                <button className="btn small ghost danger" aria-label={`Delete ${u.username}`} onClick={() => setDel(u)}><Trash2 /></button>
              </div>}
            </div>))}</div>)}
      </section>

      {create && (
        <Modal title="Add person" onClose={() => setCreate(null)} actions={<><button className="btn" onClick={() => setCreate(null)}>Cancel</button>
          <button className="btn primary" disabled={create.username.length < 3} onClick={async () => {
            const r = await act(() => api('/users', { method: 'POST', body: { username: create.username, role: create.role, password: create.password || undefined } }), 'Account created');
            if (r) { setCreate(null); if (r.password) setSecret({ title: `Password for ${r.user.username}`, value: r.password }); }
          }}>Create account</button></>}>
          <Field label="Username">{(id) => <input id={id} className="input" value={create.username} onChange={(e) => setCreate({ ...create, username: e.target.value })} autoComplete="off" />}</Field>
          <Field label="Role">{(id) => <select id={id} value={create.role} onChange={(e) => setCreate({ ...create, role: e.target.value })}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}</Field>
          <Field label="Password" hint="Leave empty to generate a strong one. You will see it once.">{(id) => <input id={id} className="input" type="text" value={create.password} onChange={(e) => setCreate({ ...create, password: e.target.value })} autoComplete="off" />}</Field>
        </Modal>)}
      {edit && (
        <Modal title={`Change role for ${edit.username}`} onClose={() => setEdit(null)} actions={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button>
          <button className="btn primary" onClick={async () => { await act(() => api(`/users/${edit.id}`, { method: 'PATCH', body: { role: edit.role } }), 'Role changed'); setEdit(null); }}>Save role</button></>}>
          <div className="role-list">{roles.map((r) => (
            <button key={r.id} className="role-btn" aria-pressed={edit.role === r.id} onClick={() => setEdit({ ...edit, role: r.id })}><span><b>{r.name}</b><div className="muted" style={{ fontSize: 13.5 }}>{r.description}</div></span><span className="muted num">{r.permissions.length} permissions</span></button>))}</div>
        </Modal>)}
      {del && <Confirm title={`Delete ${del.username}?`} danger confirmLabel="Delete account" body="They can no longer sign in. Their past activity stays in the log." onClose={() => setDel(null)}
        onConfirm={async () => { await act(() => api(`/users/${del.id}`, { method: 'DELETE' }), 'Account deleted'); setDel(null); }} />}
      {secret && (
        <Modal title={secret.title} onClose={() => setSecret(null)} actions={<button className="btn primary" onClick={() => setSecret(null)}>Done</button>}>
          <div className="muted">Share it privately. This is the only time it is shown, and they should change it after signing in.</div>
          <div className="address"><code>{secret.value}</code><button className="btn ghost small" onClick={() => copy(secret.value)}><Copy />Copy</button></div>
        </Modal>)}
    </>
  );
}

function RolesTab() {
  const { data, reload } = useApi('/roles');
  const me = useMe();
  const toast = useToast();
  const [sel, setSel] = useState('');
  const [draft, setDraft] = useState(null);
  const [newRole, setNewRole] = useState(null);
  const [del, setDel] = useState(null);
  const roles = data?.roles || [];
  useEffect(() => { if (data && !sel) setSel(data.roles[1]?.id || data.roles[0].id); }, [data]);
  const role = roles.find((r) => r.id === sel);
  useEffect(() => { if (role) setDraft({ permissions: [...role.permissions], description: role.description }); }, [role?.id, data]);
  const groups = useMemo(() => { const g = {}; for (const p of data?.permissions || []) (g[p.group] ||= []).push(p); return Object.entries(g); }, [data]);
  if (!data || !role || !draft) return <div className="skeleton" style={{ height: 300 }} />;
  const dirty = JSON.stringify([...draft.permissions].sort()) !== JSON.stringify([...role.permissions].sort()) || draft.description !== role.description;
  const toggle = (id) => setDraft((d) => ({ ...d, permissions: d.permissions.includes(id) ? d.permissions.filter((x) => x !== id) : [...d.permissions, id] }));
  const save = async () => { try { await api(`/roles/${role.id}`, { method: 'PUT', body: draft }); toast('Role saved'); reload(); } catch (e) { toast(e.message, 'err'); } };

  return (
    <div className="split">
      <div className="stack-sm">
        <div className="role-list">{roles.map((r) => (
          <button key={r.id} className="role-btn" aria-pressed={sel === r.id} onClick={() => setSel(r.id)}><span><b>{r.name}</b>{r.builtin && <span className="faint" style={{ marginLeft: 8, fontSize: 12.5 }}>built-in</span>}</span><span className="muted num">{r.permissions.length}</span></button>))}</div>
        <button className="btn" onClick={() => setNewRole({ name: '', description: '', permissions: [...role.permissions].filter((p) => me.can(p)) })}><Plus />New role</button>
      </div>
      <section className="panel">
        <div className="panel-head"><div><h2>{role.name}</h2><div className="muted">{role.locked ? 'The owner always has every permission.' : 'Turn permissions on or off, then save.'}</div></div>
          <div className="actions">{!role.builtin && <button className="btn small ghost danger" onClick={() => setDel(role)}><Trash2 />Delete</button>}
            <button className="btn primary small" disabled={!dirty || role.locked} onClick={save}>Save changes</button></div></div>
        {groups.map(([g, perms]) => (
          <div className="perm-group" key={g}>
            <h3>{g}</h3>
            {perms.map((p) => (
              <div className="perm-row" key={p.id}>
                <div className="t"><div style={{ fontWeight: 550 }}>{p.label}{p.danger && <span className="pill danger" style={{ marginLeft: 8 }}>Powerful</span>}</div><small className="mono">{p.id}</small></div>
                <Toggle checked={draft.permissions.includes(p.id)} label={p.label} disabled={role.locked || (!me.can(p.id) && !role.permissions.includes(p.id))} onChange={() => toggle(p.id)} />
              </div>))}
          </div>))}
      </section>
      {newRole && (
        <Modal title="New role" onClose={() => setNewRole(null)} actions={<><button className="btn" onClick={() => setNewRole(null)}>Cancel</button>
          <button className="btn primary" disabled={newRole.name.trim().length < 2} onClick={async () => { try { const r = await api('/roles', { method: 'POST', body: newRole }); toast('Role created'); await reload(); setSel(r.role.id); setNewRole(null); } catch (e) { toast(e.message, 'err'); } }}>Create role</button></>}>
          <Field label="Name">{(id) => <input id={id} className="input" value={newRole.name} onChange={(e) => setNewRole({ ...newRole, name: e.target.value })} maxLength={40} />}</Field>
          <Field label="Description">{(id) => <input id={id} className="input" value={newRole.description} onChange={(e) => setNewRole({ ...newRole, description: e.target.value })} maxLength={120} />}</Field>
          <div className="hint">It starts with the permissions of “{role.name}” that you hold. Adjust them after creating it.</div>
        </Modal>)}
      {del && <Confirm title={`Delete ${del.name}?`} danger confirmLabel="Delete role" body="Roles that people still use cannot be deleted." onClose={() => setDel(null)}
        onConfirm={async () => { try { await api(`/roles/${del.id}`, { method: 'DELETE' }); toast('Role deleted'); setSel(''); reload(); } catch (e) { toast(e.message, 'err'); } setDel(null); }} />}
    </div>
  );
}
