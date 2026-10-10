import { useState } from 'react';
import { AlertTriangle, Boxes } from 'lucide-react';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { useMe } from '../App.jsx';
import { Confirm, PageHead, Spinner, useToast } from '../ui.jsx';

export default function Versions() {
  const { data, error, reload } = useApi('/versions');
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [upd, setUpd] = useState(false);
  const me = useMe();
  const manage = me.can('versions.manage');
  const toast = useToast();
  if (error && !data) return <div className="stack"><PageHead title="Versions" /><div className="panel panel-pad err-text">{error.message}</div></div>;
  if (!data) return <div className="skeleton" style={{ height: 300 }} />;
  const list = data.versions.filter((v) => !v.preview || more);
  const shown = more ? list : list.slice(0, 14);
  const idx = (v) => data.versions.findIndex((x) => x.id === v);
  const worldIdx = data.world ? idx(data.world) : -1;

  const go = async () => {
    setBusy(true);
    try { await api('/versions/switch', { method: 'POST', body: { version: pick } }); toast(`Switching to ${pick}. The server is restarting.`); setPick(null); reload(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const updateBuild = async () => {
    setBusy(true);
    try { await api('/versions/update-build', { method: 'POST' }); toast('Paper updated. The server is restarting.'); setUpd(false); reload(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <PageHead title="Versions">Choose the Minecraft version Paper runs. A full backup is taken automatically before every switch.</PageHead>
      <section className="panel panel-pad row spread wrap">
        <div className="row"><div className="avatar"><Boxes size={18} /></div><div><div className="label">Running now</div><h2>{data.software} {data.current || 'unknown'}</h2></div></div>
        <div><div className="label">World last saved in</div><h2>{data.world || 'unknown'}</h2></div>
      </section>
      {data.build && (
        <section className="panel panel-pad row spread wrap">
          <div><div className="label">Paper build</div><h2>Build {data.build}{data.latestBuild ? <span className="muted" style={{ fontWeight: 500, fontSize: 15 }}> · newest is {data.latestBuild.id} ({data.latestBuild.channel.toLowerCase()})</span> : null}</h2>
            <div className="muted">Builds are small fixes for the same Minecraft version. Updating is low risk and takes a backup first.</div></div>
          {data.buildUpdateAvailable ? <button className="btn primary" disabled={!manage} onClick={() => setUpd(true)}>Update to build {data.latestBuild.id}</button> : <span className="pill ok">Up to date</span>}
        </section>)}
      <div className="panel panel-pad row" style={{ alignItems: 'flex-start' }}>
        <AlertTriangle color="var(--warn)" style={{ flex: 'none', marginTop: 2 }} />
        <div className="muted">Newer versions can open older worlds, but never the other way round, so versions older than your world are blocked. Players need a matching client version (TLauncher can install any version). After switching, check that your plugins have a build for the new version.</div>
      </div>
      <section className="panel">
        <div className="list">{shown.map((v) => {
          const current = v.id === data.current, older = worldIdx !== -1 && idx(v.id) > worldIdx;
          return (
            <div className="item" key={v.id} style={{ opacity: older ? .5 : 1 }}>
              <div className="grow"><div className="title mono" style={{ fontSize: 15 }}>{v.id}{current && <span className="pill brand">Running</span>}{v.preview && <span className="pill warn">Preview</span>}{older && <span className="pill">Older than world</span>}</div></div>
              <button className="btn small" disabled={current || older || !manage} onClick={() => setPick(v.id)}>Switch</button>
            </div>); })}</div>
        <div className="panel-pad" style={{ borderTop: '1px solid var(--line-soft)' }}><button className="btn small ghost" onClick={() => setMore((m) => !m)}>{more ? 'Show fewer' : 'Show all versions, including previews'}</button></div>
      </section>
      {upd && <Confirm title={`Update Paper to build ${data.latestBuild.id}?`} confirmLabel={busy ? 'Working…' : 'Back up and update'} busy={busy} onClose={() => !busy && setUpd(false)} onConfirm={updateBuild} body="A backup is taken first, then the server restarts on the newer build. Players are disconnected for about a minute." />}
      {pick && <Confirm title={`Switch to ${pick}?`} confirmLabel={busy ? 'Working…' : 'Back up and switch'} busy={busy} onClose={() => !busy && setPick(null)} onConfirm={go}
        body="The world is backed up first, then the server restarts on the new version. Players are disconnected for about a minute." />}
    </div>
  );
}
