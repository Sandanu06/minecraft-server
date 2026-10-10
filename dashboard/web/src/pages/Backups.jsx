import { useState } from 'react';
import { Archive, Download, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { ago, bytes, dateTime } from '../format.js';
import { Confirm, Empty, PageHead, Spinner, Toggle, useToast } from '../ui.jsx';
import { useServer } from '../App.jsx';

const KIND = { auto: ['Daily', 'ok'], manual: ['Manual', ''], safety: ['Safety', 'brand'] };

export default function Backups() {
  const { data, reload } = useApi('/backups', { every: 15000 });
  const server = useServer();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState(null);
  const [del, setDel] = useState(null);
  const op = server.data?.op;

  const create = async () => {
    setBusy(true);
    try { const r = await api('/backups', { method: 'POST', body: { note: 'manual' } }); toast(`Backup saved (${bytes(r.size)})`); reload(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const saveSchedule = async (patch) => { try { await api('/backups/schedule', { method: 'PUT', body: patch }); reload(); toast('Schedule saved'); } catch (e) { toast(e.message, 'err'); } };
  const s = data?.schedule;

  return (
    <div className="stack">
      <PageHead title="Backups" actions={<button className="btn primary" onClick={create} disabled={busy || !!op}>{busy || op?.type === 'backup' ? <Spinner /> : <Archive />}Back up now</button>}>
        Everything your friends built is saved here. A backup takes a minute and the game keeps running.
      </PageHead>
      {op && <div className="panel panel-pad row"><Spinner /><b>{op.type}</b><span className="muted">{op.message || 'Working…'}</span></div>}

      <section className="panel panel-pad row spread wrap">
        <div className="row"><ShieldCheck color="var(--ok)" /><div><h3>Daily backup</h3><div className="muted">Runs automatically; the newest {s?.keep ?? 7} daily copies are kept.</div></div></div>
        {s && <div className="row wrap">
          <label className="row" style={{ gap: 8 }}><span className="muted">At</span>
            <select style={{ width: 120 }} value={s.hourUtc} onChange={(e) => saveSchedule({ hourUtc: Number(e.target.value) })} aria-label="Hour (UTC)">
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00 UTC</option>)}</select></label>
          <label className="row" style={{ gap: 8 }}><span className="muted">Keep</span>
            <select style={{ width: 90 }} value={s.keep} onChange={(e) => saveSchedule({ keep: Number(e.target.value) })} aria-label="Copies to keep">
              {[3, 7, 14, 30].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <Toggle checked={s.enabled} label="Daily backup" onChange={(v) => saveSchedule({ enabled: v })} />
        </div>}
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Saved backups</h2><span className="muted">{data ? `${bytes(data.disk.free)} free on the backup disk` : ''}</span></div>
        {!data ? <div className="skeleton" style={{ height: 120, margin: 20 }} /> : data.backups.length === 0 ? <Empty icon={Archive} title="No backups yet">Press “Back up now” to make the first one.</Empty> : (
          <div className="list">{data.backups.map((b) => {
            const [label, tone] = KIND[b.kind];
            return (
              <div className="item" key={b.name}>
                <div className="grow"><div className="title">{dateTime(b.created)}<span className={`pill ${tone}`}>{label}</span></div><div className="sub mono">{b.name} · {bytes(b.size)} · {ago(b.created)}</div></div>
                <div className="actions">
                  <a className="btn small" href={`/api/backups/${b.name}/download`}><Download />Download</a>
                  <button className="btn small" disabled={!!op} onClick={() => setRestore(b)}><RotateCcw />Restore</button>
                  <button className="btn small ghost danger" aria-label="Delete backup" onClick={() => setDel(b)}><Trash2 /></button>
                </div>
              </div>); })}</div>)}
      </section>

      {restore && <Confirm title="Restore this backup?" danger typed="restore" confirmLabel="Restore world"
        body={<>The server stops, the current files are set aside, and <b>{dateTime(restore.created)}</b> is restored. A safety backup of the current world is taken first, so you can undo this.</>}
        onClose={() => setRestore(null)}
        onConfirm={async () => { try { await api(`/backups/${restore.name}/restore`, { method: 'POST' }); toast('Restore started. The server restarts when it finishes.'); reload(); } catch (e) { toast(e.message, 'err'); } setRestore(null); }} />}
      {del && <Confirm title="Delete this backup?" danger confirmLabel="Delete" body={`${del.name} is removed permanently.`} onClose={() => setDel(null)}
        onConfirm={async () => { try { await api(`/backups/${del.name}`, { method: 'DELETE' }); toast('Backup deleted'); reload(); } catch (e) { toast(e.message, 'err'); } setDel(null); }} />}
    </div>
  );
}
