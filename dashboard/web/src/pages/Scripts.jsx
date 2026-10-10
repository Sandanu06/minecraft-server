import { useEffect, useRef, useState } from 'react';
import { CalendarClock, Clock, Pencil, Play, Plus, ScrollText, Square, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { useMe } from '../App.jsx';
import { ago, dateTime } from '../format.js';
import { Confirm, Empty, Field, Modal, PageHead, Spinner, Tabs, Toggle, useToast } from '../ui.jsx';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const whenText = (w) => (w.kind === 'interval' ? `Every ${w.everyMinutes % 60 === 0 ? `${w.everyMinutes / 60} hour${w.everyMinutes === 60 ? '' : 's'}` : `${w.everyMinutes} minutes`}` : w.kind === 'daily' ? `Every day at ${w.time}` : `${w.days.map((d) => DAYS[d]).join(', ')} at ${w.time}`);

export default function Scripts() {
  const [tab, setTab] = useState('scripts');
  return (
    <div className="stack">
      <PageHead title="Scripts">Saved sequences of commands you can run with one click or on a schedule. Choose which roles may run each one.</PageHead>
      <Tabs value={tab} onChange={setTab} items={[['scripts', 'Scripts'], ['schedules', 'Schedules'], ['runs', 'Recent runs']]} />
      {tab === 'scripts' && <ScriptsTab />}
      {tab === 'schedules' && <SchedulesTab />}
      {tab === 'runs' && <RunsTab />}
    </div>
  );
}

/* ---------- live run viewer ---------- */
function RunViewer({ runId, onClose }) {
  const toast = useToast();
  const { data, reload } = useApi(`/script-runs/${runId}`, { every: 1000 });
  const box = useRef(null);
  const run = data?.run;
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [run?.lines?.length]);
  const cancel = async () => { try { await api(`/script-runs/${runId}/cancel`, { method: 'POST' }); reload(); } catch (e) { toast(e.message, 'err'); } };
  const tone = { running: 'warn', done: 'ok', failed: 'bad', skipped: '', cancelled: '' }[run?.status] || '';
  return (
    <Modal wide title={run ? run.name : 'Running…'} onClose={onClose} actions={<>
      {run?.status === 'running' && <button className="btn danger" onClick={cancel}><Square />Stop script</button>}
      <button className="btn primary" onClick={onClose}>Close</button></>}>
      {run && <div className="row spread"><span className={`pill ${tone}`}>{run.status === 'running' ? <Spinner size={13} /> : <i className="dot" />}{run.status}</span><span className="muted num">Step {run.step} of {run.total}</span></div>}
      {run && <div className="progress"><i style={{ width: `${(run.step / Math.max(run.total, 1)) * 100}%` }} /></div>}
      <div ref={box} className="term-out" style={{ background: 'var(--term)', color: '#d6d8de', borderRadius: 12, maxHeight: 320, minHeight: 160 }}>
        <div className="steps">{(run?.lines || []).map((l, i) => <div key={i} className={l.kind}>{l.kind === 'step' ? `› ${l.text}` : l.text}</div>)}</div>
      </div>
    </Modal>
  );
}

/* ---------- scripts ---------- */
function ScriptsTab() {
  const { data, reload } = useApi('/scripts');
  const me = useMe();
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [runId, setRunId] = useState('');
  const roles = useApi('/role-names', { enabled: me.can('scripts.manage') });

  const run = async (s) => { try { const r = await api(`/scripts/${s.id}/run`, { method: 'POST' }); setRunId(r.run.id); } catch (e) { toast(e.message, 'err'); } };
  const save = async () => {
    try {
      const body = { name: edit.name, description: edit.description, body: edit.body, enabled: edit.enabled, roles: edit.roles };
      if (edit.id) await api(`/scripts/${edit.id}`, { method: 'PUT', body }); else await api('/scripts', { method: 'POST', body });
      toast('Script saved'); setEdit(null); reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  const roleLabel = (s) => (s.roles.length ? `Only ${s.roles.map((id) => roles.data?.roles.find((r) => r.id === id)?.name || id).join(', ')}` : 'Anyone who can run scripts');

  return (
    <>
      {me.can('scripts.manage') && <div className="row spread"><span className="muted">Scripts can run any command, so only give “manage scripts” to people you trust.</span><button className="btn primary" onClick={() => setEdit({ name: '', description: '', body: '# One step per line\nsay Hello from a script\n', enabled: true, roles: [] })}><Plus />New script</button></div>}
      <section className="panel">
        {!data ? <div className="skeleton" style={{ height: 120, margin: 20 }} /> : data.scripts.length === 0 ? <Empty icon={ScrollText} title="No scripts yet">Create one to automate things like restarts and announcements.</Empty> : (
          <div className="list">{data.scripts.map((s) => (
            <div className="item" key={s.id} style={{ opacity: s.enabled ? 1 : .6 }}>
              <div className="avatar"><ScrollText size={18} /></div>
              <div className="grow"><div className="title">{s.name}{!s.enabled && <span className="pill">Turned off</span>}</div><div className="sub">{s.description || 'No description'} · {roleLabel(s)}</div></div>
              <div className="actions">
                <button className="btn small primary" disabled={!s.canRun} title={s.canRun ? '' : 'Your role cannot run this script'} onClick={() => run(s)}><Play />Run</button>
                {me.can('scripts.manage') && <><button className="btn small" onClick={() => setEdit({ ...s })}><Pencil />Edit</button><button className="btn small ghost danger" aria-label={`Delete ${s.name}`} onClick={() => setDel(s)}><Trash2 /></button></>}
              </div>
            </div>))}</div>)}
      </section>

      {edit && (
        <Modal wide title={edit.id ? `Edit ${edit.name}` : 'New script'} onClose={() => setEdit(null)} actions={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" disabled={edit.name.trim().length < 2} onClick={save}>Save script</button></>}>
          <div className="cols" style={{ gap: 14 }}>
            <Field label="Name">{(id) => <input id={id} className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={60} />}</Field>
            <Field label="Description">{(id) => <input id={id} className="input" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} maxLength={160} />}</Field>
          </div>
          <Field label="Steps">{(id) => <textarea id={id} className="code" rows={11} spellCheck="false" value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />}</Field>
          <div className="cheat">
            <div><code>say Hello</code> any console command, one per line (the leading / is optional)</div>
            <div><code>wait 30s</code> <code>wait 5m</code> pause before the next step</div>
            <div><code>@broadcast Text</code> <code>@backup label</code> <code>@restart</code> <code>@stop</code> <code>@start</code> <code>@save</code></div>
            <div><code>@abort-if-players</code> stop the script when anyone is online · <code># note</code> a comment</div>
          </div>
          <div className="field"><label>Who can run it</label>
            <div className="chiprow">{(roles.data?.roles || []).map((r) => {
              const on = edit.roles.includes(r.id);
              return <button type="button" key={r.id} className="chip" aria-pressed={on} style={on ? { background: 'var(--brand-wash)', borderColor: 'var(--brand)', color: 'var(--text)' } : undefined} onClick={() => setEdit({ ...edit, roles: on ? edit.roles.filter((x) => x !== r.id) : [...edit.roles, r.id] })}>{r.name}</button>;
            })}</div>
            <div className="hint">{edit.roles.length ? 'Only the roles above (and owners) can run it.' : 'Leave empty to let anyone who has the “run scripts” permission run it.'}</div></div>
          <div className="row"><Toggle checked={edit.enabled} onChange={(v) => setEdit({ ...edit, enabled: v })} label="Script enabled" /><span>Enabled</span></div>
        </Modal>)}
      {del && <Confirm title={`Delete ${del.name}?`} danger confirmLabel="Delete script" body="This cannot be undone." onClose={() => setDel(null)}
        onConfirm={async () => { try { await api(`/scripts/${del.id}`, { method: 'DELETE' }); toast('Script deleted'); reload(); } catch (e) { toast(e.message, 'err'); } setDel(null); }} />}
      {runId && <RunViewer runId={runId} onClose={() => setRunId('')} />}
    </>
  );
}

/* ---------- schedules ---------- */
function SchedulesTab() {
  const { data, reload } = useApi('/schedules');
  const scripts = useApi('/scripts');
  const me = useMe();
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const manage = me.can('schedules.manage');
  const zones = (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []).concat('UTC');

  const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg); reload(); } catch (e) { toast(e.message, 'err'); } };
  const targetText = (t) => (t.type === 'backup' ? 'Back up the world' : t.type === 'restart' ? 'Restart the server' : `Run “${scripts.data?.scripts.find((s) => s.id === t.scriptId)?.name || 'script'}”`);
  const blank = { name: '', enabled: true, target: { type: 'backup' }, when: { kind: 'daily', time: '04:00', days: [1, 2, 3, 4, 5], everyMinutes: 60 } };
  const save = async () => {
    const w = edit.when;
    const when = w.kind === 'interval' ? { kind: 'interval', everyMinutes: Number(w.everyMinutes) } : w.kind === 'weekly' ? { kind: 'weekly', time: w.time, days: w.days } : { kind: 'daily', time: w.time };
    const body = { name: edit.name, enabled: edit.enabled, target: edit.target, when };
    await act(async () => { if (edit.id) await api(`/schedules/${edit.id}`, { method: 'PUT', body }); else await api('/schedules', { method: 'POST', body }); setEdit(null); }, 'Schedule saved');
  };

  return (
    <>
      <div className="row spread wrap">
        <label className="row" style={{ gap: 8 }}><Clock size={17} /><span className="muted">Times use</span>
          <select style={{ width: 230 }} value={data?.timezone || 'UTC'} disabled={!manage} onChange={(e) => act(() => api('/schedules/timezone', { method: 'PUT', body: { timezone: e.target.value } }), 'Time zone saved')} aria-label="Time zone">
            {zones.map((z) => <option key={z}>{z}</option>)}</select></label>
        {manage && <button className="btn primary" onClick={() => setEdit(structuredClone(blank))}><Plus />New schedule</button>}
      </div>
      <section className="panel">
        {!data ? <div className="skeleton" style={{ height: 120, margin: 20 }} /> : data.schedules.length === 0 ? <Empty icon={CalendarClock} title="Nothing scheduled">Schedule a nightly restart, a daily announcement, or an extra backup.</Empty> : (
          <div className="list">{data.schedules.map((s) => (
            <div className="item" key={s.id} style={{ opacity: s.enabled ? 1 : .6 }}>
              <div className="avatar"><CalendarClock size={18} /></div>
              <div className="grow"><div className="title">{s.name}</div><div className="sub">{targetText(s.target)} · {whenText(s.when)}{s.lastRunAt ? ` · last ran ${ago(new Date(s.lastRunAt))}${s.lastStatus?.startsWith('failed') ? ` (${s.lastStatus})` : ''}` : ''}</div></div>
              {manage && <div className="actions">
                <Toggle checked={s.enabled} label={`${s.name} enabled`} onChange={(v) => act(() => api(`/schedules/${s.id}`, { method: 'PUT', body: { enabled: v } }), v ? 'Schedule on' : 'Schedule off')} />
                <button className="btn small" onClick={() => setEdit(structuredClone({ ...s, when: { kind: 'daily', time: '04:00', days: [1], everyMinutes: 60, ...s.when } }))}><Pencil />Edit</button>
                <button className="btn small ghost danger" aria-label={`Delete ${s.name}`} onClick={() => setDel(s)}><Trash2 /></button>
              </div>}
            </div>))}</div>)}
      </section>

      {edit && (
        <Modal title={edit.id ? 'Edit schedule' : 'New schedule'} onClose={() => setEdit(null)} actions={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" disabled={edit.name.trim().length < 2 || (edit.target.type === 'script' && !edit.target.scriptId)} onClick={save}>Save schedule</button></>}>
          <Field label="Name">{(id) => <input id={id} className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={60} />}</Field>
          <Field label="What should happen">{(id) => <select id={id} value={edit.target.type === 'script' ? `script:${edit.target.scriptId || ''}` : edit.target.type} onChange={(e) => { const v = e.target.value; setEdit({ ...edit, target: v.startsWith('script:') ? { type: 'script', scriptId: v.slice(7) } : { type: v } }); }}>
            <option value="backup">Back up the world</option><option value="restart">Restart the server</option>
            <optgroup label="Run a script">{(scripts.data?.scripts || []).map((s) => <option key={s.id} value={`script:${s.id}`}>{s.name}</option>)}</optgroup></select>}</Field>
          <Field label="How often">{(id) => <select id={id} value={edit.when.kind} onChange={(e) => setEdit({ ...edit, when: { ...edit.when, kind: e.target.value } })}><option value="daily">Every day</option><option value="weekly">On certain days</option><option value="interval">Every few minutes or hours</option></select>}</Field>
          {edit.when.kind !== 'interval' && <Field label="At">{(id) => <input id={id} className="input" type="time" value={edit.when.time} onChange={(e) => setEdit({ ...edit, when: { ...edit.when, time: e.target.value } })} />}</Field>}
          {edit.when.kind === 'weekly' && <div className="chiprow">{DAYS.map((d, i) => { const on = edit.when.days.includes(i); return <button type="button" key={d} className="chip" style={on ? { background: 'var(--brand-wash)', borderColor: 'var(--brand)', color: 'var(--text)' } : undefined} onClick={() => setEdit({ ...edit, when: { ...edit.when, days: on ? edit.when.days.filter((x) => x !== i) : [...edit.when.days, i] } })}>{d}</button>; })}</div>}
          {edit.when.kind === 'interval' && <Field label="Repeat every (minutes)" hint="From 5 minutes to 7 days. 60 = hourly, 1440 = daily.">{(id) => <input id={id} className="input" type="number" min={5} max={10080} value={edit.when.everyMinutes} onChange={(e) => setEdit({ ...edit, when: { ...edit.when, everyMinutes: e.target.value } })} />}</Field>}
          <div className="row"><Toggle checked={edit.enabled} onChange={(v) => setEdit({ ...edit, enabled: v })} label="Enabled" /><span>Enabled</span></div>
        </Modal>)}
      {del && <Confirm title={`Delete ${del.name}?`} danger confirmLabel="Delete schedule" body="It will stop running." onClose={() => setDel(null)}
        onConfirm={async () => { await act(() => api(`/schedules/${del.id}`, { method: 'DELETE' }), 'Schedule deleted'); setDel(null); }} />}
    </>
  );
}

function RunsTab() {
  const { data } = useApi('/script-runs', { every: 3000 });
  const [open, setOpen] = useState('');
  return (
    <section className="panel table-wrap">
      {!data ? <div className="skeleton" style={{ height: 100, margin: 20 }} /> : data.runs.length === 0 ? <Empty icon={ScrollText} title="No runs yet">Runs from this session appear here.</Empty> : (
        <table className="tbl"><thead><tr><th>Script</th><th>Started</th><th>By</th><th>Result</th><th /></tr></thead>
          <tbody>{data.runs.map((r) => <tr key={r.id}><td>{r.name}</td><td className="muted">{dateTime(r.startedAt)}</td><td>{r.user}</td>
            <td><span className={`pill ${{ done: 'ok', failed: 'bad', running: 'warn' }[r.status] || ''}`}>{r.status}</span></td><td className="r"><button className="btn small" onClick={() => setOpen(r.id)}>Details</button></td></tr>)}</tbody></table>)}
      {open && <RunViewer runId={open} onClose={() => setOpen('')} />}
    </section>
  );
}
