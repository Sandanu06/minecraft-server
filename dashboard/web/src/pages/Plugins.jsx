import { useEffect, useRef, useState } from 'react';
import { ArrowUpCircle, Download, Package, Search, Trash2, Upload } from 'lucide-react';
import { api, markRestartNeeded } from '../api.js';
import { useApi } from '../hooks.js';
import { bytes, compact } from '../format.js';
import { Confirm, Empty, PageHead, Spinner, Tabs, Toggle, useToast } from '../ui.jsx';

export default function Plugins() {
  const [tab, setTab] = useState('installed');
  const installed = useApi('/plugins');
  const updates = useApi('/plugins/updates');
  const toast = useToast();
  const [remove, setRemove] = useState(null);
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const upd = Object.fromEntries((updates.data?.updates || []).map((u) => [u.id, u]));

  const done = (msg) => { toast(msg); markRestartNeeded(); installed.reload(); updates.reload(); };
  const toggle = async (f) => { try { await api(`/plugins/${encodeURIComponent(f)}/toggle`, { method: 'POST' }); done('Plugin updated. Restart to apply.'); } catch (e) { toast(e.message, 'err'); } };
  const upload = async (file) => {
    if (!file) return; setUploading(true);
    const form = new FormData(); form.append('file', file);
    try { await api('/plugins/upload', { method: 'POST', form }); done(`${file.name} uploaded`); } catch (e) { toast(e.message, 'err'); } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const update = async (id) => { try { await api('/plugins/install', { method: 'POST', body: { id } }); done('Updated. Restart to apply.'); } catch (e) { toast(e.message, 'err'); } };

  return (
    <div className="stack">
      <PageHead title="Plugins" actions={<>
        <input ref={fileRef} type="file" accept=".jar" hidden onChange={(e) => upload(e.target.files[0])} />
        <button className="btn" onClick={() => fileRef.current.click()} disabled={uploading}>{uploading ? <Spinner /> : <Upload />}Upload .jar</button></>}>
        Plugins add features to Paper without changing how the game plays for everyone. Changes apply after a restart.
      </PageHead>
      <Tabs value={tab} onChange={setTab} items={[['installed', `Installed${installed.data ? ` (${installed.data.plugins.length})` : ''}`], ['browse', 'Browse Modrinth']]} />

      {tab === 'installed' && (
        <section className="panel">
          {!installed.data ? <div className="skeleton" style={{ height: 120, margin: 20 }} /> : installed.data.plugins.length === 0 ? (
            <Empty icon={Package} title="No plugins yet">Browse Modrinth to add your first one.<button className="btn primary" style={{ marginTop: 10 }} onClick={() => setTab('browse')}>Browse plugins</button></Empty>
          ) : <div className="list">{installed.data.plugins.map((p) => (
            <div className="item" key={p.file} style={{ opacity: p.enabled ? 1 : .6 }}>
              {p.source?.icon ? <img className="avatar" src={p.source.icon} alt="" width="36" height="36" /> : <div className="avatar"><Package size={18} /></div>}
              <div className="grow">
                <div className="title">{p.name}<span className="faint num" style={{ fontWeight: 500 }}>{p.version}</span>
                  {!p.enabled && <span className="pill">Disabled</span>}
                  {p.source && upd[p.source.id] && <span className="pill brand">Update to {upd[p.source.id].latest}</span>}</div>
                <div className="sub">{p.description || p.file} · {bytes(p.size)}</div>
              </div>
              {p.source && upd[p.source.id] && <button className="btn small primary" onClick={() => update(p.source.id)}><ArrowUpCircle />Update</button>}
              <Toggle checked={p.enabled} label={`${p.enabled ? 'Disable' : 'Enable'} ${p.name}`} onChange={() => toggle(p.file)} />
              <button className="btn ghost icon danger" aria-label={`Remove ${p.name}`} onClick={() => setRemove(p)}><Trash2 size={17} /></button>
            </div>))}</div>}
        </section>
      )}
      {tab === 'browse' && <Browse onInstalled={() => { markRestartNeeded(); installed.reload(); }} />}

      {remove && <Confirm title={`Remove ${remove.name}?`} danger confirmLabel="Remove plugin" body="The jar is deleted. Its settings folder stays, so reinstalling keeps your configuration."
        onClose={() => setRemove(null)} onConfirm={async () => { try { await api(`/plugins/${encodeURIComponent(remove.file)}`, { method: 'DELETE' }); done('Plugin removed'); } catch (e) { toast(e.message, 'err'); } setRemove(null); }} />}
    </div>
  );
}

function Browse({ onInstalled }) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState('');
  const [featured, setFeatured] = useState(null);
  const toast = useToast();
  useEffect(() => { api('/plugins/featured').then(setFeatured).catch(() => setFeatured({ items: [] })); }, []);
  useEffect(() => {
    const t = setTimeout(() => { setRes(null); api(`/plugins/search?q=${encodeURIComponent(q)}${all ? '&all=1' : ''}`).then(setRes).catch((e) => { toast(e.message, 'err'); setRes({ hits: [], total: 0 }); }); }, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [q, all]);
  const install = async (h) => {
    setBusy(h.id);
    try { const r = await api('/plugins/install', { method: 'POST', body: { id: h.id } }); toast(`${r.installed.map((i) => i.title).join(', ')} installed. Restart to apply.`); onInstalled(); setRes((s) => s && ({ ...s, hits: s.hits.map((x) => (x.id === h.id ? { ...x, installed: true } : x)) })); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  return (
    <div className="stack">
      <div className="row wrap">
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={17} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--faint)' }} />
          <input className="input" style={{ paddingLeft: 38 }} placeholder="Search plugins" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search plugins" />
        </div>
        <label className="row" style={{ gap: 8 }}><Toggle checked={!all} onChange={(v) => setAll(!v)} label="Only show compatible" /><span className="muted">Only for Minecraft {res?.gameVersion || 'this version'}</span></label>
      </div>
      {!q && featured?.items?.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>Recommended for your server</h2><span className="muted">Verified for Minecraft {featured.gameVersion}</span></div>
          <div className="list">{featured.items.map((h) => (
            <div className="item" key={h.id}>
              {h.icon ? <img className="avatar" src={h.icon} alt="" width="36" height="36" loading="lazy" /> : <div className="avatar"><Package size={18} /></div>}
              <div className="grow"><div className="title">{h.title}<span className="faint num" style={{ fontWeight: 500 }}>{h.version}</span></div><div className="sub">{h.description}</div></div>
              <button className={`btn small ${h.installed ? '' : 'primary'}`} disabled={h.installed || busy === h.id} onClick={() => install(h).then(() => setFeatured((f) => ({ ...f, items: f.items.map((x) => (x.id === h.id ? { ...x, installed: true } : x)) })))}>{busy === h.id ? <Spinner /> : <Download />}{h.installed ? 'Installed' : 'Install'}</button>
            </div>))}</div>
        </section>)}
      {!q && <h2 style={{ marginTop: 4 }}>Most downloaded</h2>}
      <section className="panel">
        {!res ? <div className="skeleton" style={{ height: 160, margin: 20 }} /> : res.hits.length === 0 ? <Empty icon={Search} title="No matching plugins">{all ? 'Try another search.' : 'Nothing compatible found. Show plugins for all versions to see more.'}</Empty> : (
          <div className="list">{res.hits.map((h) => (
            <div className="item" key={h.id}>
              {h.icon ? <img className="avatar" src={h.icon} alt="" width="36" height="36" loading="lazy" /> : <div className="avatar"><Package size={18} /></div>}
              <div className="grow"><div className="title">{h.title}<span className="faint" style={{ fontWeight: 500 }}>by {h.author}</span></div><div className="sub">{h.description}</div></div>
              <span className="muted num" title="Downloads">{compact(h.downloads)}</span>
              <button className={`btn small ${h.installed ? '' : 'primary'}`} disabled={h.installed || busy === h.id} onClick={() => install(h)}>{busy === h.id ? <Spinner /> : <Download />}{h.installed ? 'Installed' : 'Install'}</button>
            </div>))}</div>)}
      </section>
    </div>
  );
}
