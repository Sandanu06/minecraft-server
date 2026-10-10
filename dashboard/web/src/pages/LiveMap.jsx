import { useState } from 'react';
import { ExternalLink, Map as MapIcon, Pause, Play, RefreshCw } from 'lucide-react';
import { api, markRestartNeeded } from '../api.js';
import { useApi } from '../hooks.js';
import { useMe } from '../App.jsx';
import { PageHead, Spinner, useToast } from '../ui.jsx';

export default function LiveMap() {
  const { data, reload } = useApi('/map', { every: 15000 });
  const me = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const manage = me.can('worlds.manage');
  const run = async (action, msg) => { setBusy(action); try { await api(`/map/${action}`, { method: 'POST' }); toast(msg); reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); } };
  const setup = async () => { setBusy('setup'); try { await api('/map/setup', { method: 'POST' }); markRestartNeeded(); toast('BlueMap installed. Restart the server to start it.'); reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); } };
  if (!data) return <div className="skeleton" style={{ height: 240 }} />;

  return (
    <div className="stack">
      <PageHead title="Live map">A 3D map of your world that anyone with the address can open in a browser, and it updates as people build.</PageHead>
      {!data.installed ? (
        <section className="panel"><div className="empty"><MapIcon /><b style={{ color: 'var(--text)' }}>Set up the live map</b>
          <div>This installs BlueMap, the 3D web map. It downloads Minecraft’s textures from Mojang once, which BlueMap requires you to accept. The first render of a big world takes a while and uses extra processor and memory.
            {manage && <button className="btn primary" disabled={busy === 'setup'} onClick={setup}>{busy === 'setup' && <Spinner />}Install BlueMap</button>}</div></div></section>
      ) : (
        <>
          <section className="panel panel-pad row spread wrap">
            <div><div className="label">Public address</div><h2 className="mono" style={{ fontSize: 18 }}>{data.url.replace('https://', '')}</h2>
              <div className="muted">Anyone with this link can look at the map, including where players are. {data.maps.length ? `Maps: ${data.maps.join(', ')}.` : 'Maps appear after the first start.'}</div></div>
            <a className="btn primary" href={data.url} target="_blank" rel="noreferrer"><ExternalLink />Open the map</a>
          </section>
          <section className="panel panel-pad stack-sm">
            <div className="row spread"><h3>Rendering</h3>
              <span className={`pill ${data.render?.working ? 'warn' : data.render ? 'ok' : ''}`}>{!data.render ? 'Server offline' : data.render.paused ? 'Paused' : data.render.working ? 'Working' : 'Up to date'}</span></div>
            {data.render?.working && <>
              <div className="progress"><i style={{ width: `${Number.isFinite(data.render.progress) ? data.render.progress : 0}%` }} /></div>
              <div className="muted">{data.render.map ? `Drawing “${data.render.map}”` : 'Drawing'}{Number.isFinite(data.render.progress) ? ` · ${data.render.progress.toFixed(1)}%` : ''}{data.render.remaining ? ` · about ${data.render.remaining} left` : ''}{data.render.pending ? ` · ${data.render.pending} more map${data.render.pending === 1 ? '' : 's'} queued` : ''}</div>
              <div className="hint">The first drawing of a big world takes a while. The map is usable while it fills in.</div></>}
            {data.render && !data.render.working && <div className="muted">Everything is drawn and the map follows changes as people build.</div>}
          </section>
          {manage && (
            <section className="panel panel-pad stack-sm">
              <h3>Keep it fresh</h3>
              <div className="muted">The map follows changes by itself. Use these after big edits, or to take the load off the server.</div>
              <div className="quick">
                <button className="btn" disabled={!!busy} onClick={() => run('update', 'Updating the map')}><RefreshCw />Update now</button>
                <button className="btn" disabled={!!busy} onClick={() => run('freeze', 'Rendering paused')}><Pause />Pause rendering</button>
                <button className="btn" disabled={!!busy} onClick={() => run('unfreeze', 'Rendering resumed')}><Play />Resume rendering</button>
              </div>
            </section>)}
        </>
      )}
    </div>
  );
}
