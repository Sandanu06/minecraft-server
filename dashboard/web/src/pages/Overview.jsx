import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, Copy, Megaphone, Power, RefreshCw, UserX } from 'lucide-react';
import { api } from '../api.js';
import { useMe, useServer } from '../App.jsx';
import { useApi } from '../hooks.js';
import { bytes, duration } from '../format.js';
import { Confirm, PageHead, Spark, Spinner, useToast, Modal } from '../ui.jsx';

const Reading = ({ label, value, note, values, color, meter }) => (
  <div className="reading">
    <div className="k">{label}</div>
    <div className="v num">{value}</div>
    <div className="chartcell">{meter != null ? <div className={`meter ${meter > 90 ? 'bad' : meter > 75 ? 'warn' : ''}`}><i style={{ width: `${Math.min(100, meter)}%` }} /></div> : <Spark values={values || []} color={color} />}</div>
    <div className="note">{note}</div>
  </div>
);

export default function Overview() {
  const { data, reload } = useServer();
  const me = useMe();
  const hist = useApi('/history', { every: 15000 });
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [broadcast, setBroadcast] = useState(null);

  if (!data) return <div className="stack"><div className="skeleton" style={{ height: 220 }} /><div className="skeleton" style={{ height: 260 }} /></div>;
  const { live, server, disk, op, runtime } = data;
  const on = live.state === 'running' || live.state === 'starting';
  const transitioning = !!op || live.state === 'starting';
  const pts = hist.data?.points || [];
  const cpuTrend = pts.slice(-60).map((p) => p.cpu);
  const memTrend = pts.slice(-60).map((p) => p.mem);
  const tpsTrend = pts.slice(-120).map((p) => p.tps);
  const plTrend = pts.slice(-60).map((p) => p.players);
  const heapMax = runtime?.maxMemory;
  const memPct = live.memLimit ? (live.memUsed / live.memLimit) * 100 : 0;

  const act = async (action, doneMsg) => {
    setBusy(action);
    try { await api(`/server/${action}`, { method: 'POST' }); toast(doneMsg); reload(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(''); setConfirm(null); }
  };
  const address = `${location.hostname.replace(/^admin\./, '')}`;
  const copy = async () => { try { await navigator.clipboard.writeText(address); toast('Address copied'); } catch { toast('Copy failed', 'err'); } };
  const tps = live.tps;

  return (
    <div className="stack">
      <PageHead title={server.motd || 'Minecraft server'}>Version {runtime?.version || '—'} · world “{server.level}” · {server.gamemode} · {server.difficulty}</PageHead>

      <section className="panel hero">
        <div className="hero-left">
          <div className="power">
            <button className="power-switch" data-on={on} data-busy={transitioning} disabled={transitioning || !!busy || !me.can('server.power')} title={me.can('server.power') ? '' : 'Your role cannot start or stop the server'}
              aria-label={on ? 'Stop the server' : 'Start the server'}
              onClick={() => (on ? setConfirm('stop') : act('start', 'Server is starting'))}>
              <span className="thumb">{busy === 'start' || transitioning ? <Spinner size={22} /> : <Power />}</span>
            </button>
            <div className="power-text">
              <b>{live.state === 'running' ? 'Online' : live.state === 'starting' ? 'Starting up' : live.state === 'stopped' ? 'Offline' : 'Checking'}</b>
              <span>{op ? `${op.type[0].toUpperCase()}${op.type.slice(1)}${op.message ? ` · ${op.message}` : '…'}` : on ? `Up for ${duration(Date.now() - new Date(live.startedAt))}` : 'Flip the switch to start'}</span>
            </div>
          </div>
          <div className="facts">
            <span>Players <b className="num">{live.players.online} / {live.players.max || server.maxPlayers}</b></span>
            <span>Allowlist <b>{server.whitelist ? 'On' : 'Off'}</b></span>
            <span>Memory cap <b>{heapMax}</b></span>
          </div>
          <div className="address"><code>{address}</code><button className="btn ghost small" onClick={copy}><Copy />Copy</button></div>
          <div className="actions">
            <button className="btn" disabled={live.state !== 'running' || !!op || !me.can('server.power')} onClick={() => setConfirm('restart')}><RefreshCw />Restart</button>
            {me.can('players.broadcast') && <button className="btn" disabled={live.state !== 'running'} onClick={() => setBroadcast('')}><Megaphone />Broadcast</button>}
            {me.can('backups.view') && <Link className="btn" to="/backups"><Archive />Back up</Link>}
          </div>
        </div>
        <div className="hero-right">
          <div>
            <div className="label">Server speed (TPS)</div>
            <div className="tps-big"><b className="num" style={{ color: tps == null ? 'var(--faint)' : tps < 15 ? 'var(--bad)' : tps < 18 ? 'var(--warn)' : 'var(--text)' }}>{tps == null ? '—' : tps.toFixed(1)}</b><span>of 20</span></div>
          </div>
          <div style={{ height: 96 }}><Spark values={tpsTrend} min={0} max={20} height={96} area={false} /></div>
          <div className="muted">{live.mspt != null ? `${live.mspt.toFixed(1)} ms per tick · budget is 50 ms` : 'Speed readings appear once the console is connected.'}</div>
        </div>
      </section>

      <section className="panel">
        <Reading label="Processor" value={`${live.cpu.toFixed(0)}%`} note={`${live.cpuCores} cores shared`} values={cpuTrend} color="var(--info)" />
        <Reading label="Memory" value={bytes(live.memUsed)} note={`of ${heapMax} heap`} values={memTrend} color="var(--brand)" />
        <Reading label="Players" value={live.players.online} note={`peak ${Math.max(0, ...plTrend)} in the last hour`} values={plTrend} color="var(--ok)" />
        <Reading label="World size" value={bytes(disk.world)} note={`${bytes(disk.data.free)} free on disk`} meter={disk.data.total ? ((disk.data.total - disk.data.free) / disk.data.total) * 100 : 0} />
      </section>

      <div className="cols">
        <OnlinePlayers />
        <RecentLog />
      </div>

      {confirm && (
        <Confirm title={confirm === 'stop' ? 'Stop the server?' : 'Restart the server?'} confirmLabel={confirm === 'stop' ? 'Stop server' : 'Restart'} danger busy={!!busy}
          body={`${live.players.online ? `${live.players.online} player${live.players.online === 1 ? ' is' : 's are'} online and will be disconnected. ` : ''}The world is saved first.`}
          onClose={() => setConfirm(null)} onConfirm={() => act(confirm, confirm === 'stop' ? 'Server stopped' : 'Server restarted')} />
      )}
      {broadcast !== null && (
        <Modal title="Broadcast to players" onClose={() => setBroadcast(null)} actions={<>
          <button className="btn" onClick={() => setBroadcast(null)}>Cancel</button>
          <button className="btn primary" disabled={!broadcast.trim()} onClick={async () => { try { await api('/broadcast', { method: 'POST', body: { message: broadcast } }); toast('Message sent'); setBroadcast(null); } catch (e) { toast(e.message, 'err'); } }}>Send message</button></>}>
          <input className="input" value={broadcast} onChange={(e) => setBroadcast(e.target.value)} placeholder="Restarting in 5 minutes" maxLength={200} />
        </Modal>
      )}
    </div>
  );
}

function OnlinePlayers() {
  const { data } = useServer();
  const toast = useToast();
  const names = data?.live.players.names || [];
  const kick = async (name) => { try { await api('/players/kick', { method: 'POST', body: { name } }); toast(`${name} was kicked`); } catch (e) { toast(e.message, 'err'); } };
  return (
    <section className="panel">
      <div className="panel-head"><h2>Online now</h2><Link className="btn ghost small" to="/players">All players</Link></div>
      {names.length === 0 ? <div className="empty">Nobody is online.</div> : (
        <div className="list">{names.map((n) => (
          <div className="item" key={n}>
            <img className="avatar head-skin" alt="" width="36" height="36" src={`https://mc-heads.net/avatar/${n}/72`} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
            <div className="grow"><div className="title">{n}</div></div>
            {me.can('players.moderate') && <button className="btn ghost small danger" onClick={() => kick(n)}><UserX />Kick</button>}
          </div>))}
        </div>
      )}
    </section>
  );
}

function RecentLog() {
  const me = useMe();
  const { data } = useApi('/logs?tail=14', { every: 6000, enabled: me.can('console.view') });
  const lines = (data?.text || '').split('\n').filter(Boolean).slice(-10);
  return (
    <section className="panel">
      <div className="panel-head"><h2>Latest from the console</h2>{me.can('console.view') && <Link className="btn ghost small" to="/console">Open console</Link>}</div>
      <div className="term-out" style={{ background: 'var(--term)', color: '#d6d8de', borderRadius: '0 0 16px 16px', maxHeight: 290, minHeight: 120, fontSize: 12.5 }}>
        {!me.can('console.view') ? <div className="faint">Your role cannot read the console.</div> : lines.length ? lines.map((l, i) => <div key={i} className={/WARN/.test(l) ? 'warn' : /ERROR|Exception/.test(l) ? 'err' : ''}>{l.replace(/^\[\d\d:\d\d:\d\d\] /, '')}</div>) : <div className="faint">No output yet.</div>}
      </div>
    </section>
  );
}
