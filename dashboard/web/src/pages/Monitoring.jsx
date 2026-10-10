import { useState } from 'react';
import { useApi } from '../hooks.js';
import { useServer } from '../App.jsx';
import { bytes, duration } from '../format.js';
import { Chart, PageHead, Tabs } from '../ui.jsx';

export default function Monitoring() {
  const [range, setRange] = useState('1h');
  const { data } = useApi(`/history?range=${range}`, { every: 10000 });
  const server = useServer();
  const pts = data?.points || [];
  const live = server.data?.live, disk = server.data?.disk, rt = server.data?.runtime;
  const tf = range === '24h' ? (t) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : undefined;
  const pct = (d) => (d?.total ? ((d.total - d.free) / d.total) * 100 : 0);
  const Meter = ({ label, value, note }) => (
    <div className="stack-sm"><div className="row spread"><span className="label">{label}</span><b className="num">{note}</b></div>
      <div className={`meter ${value > 90 ? 'bad' : value > 75 ? 'warn' : ''}`}><i style={{ width: `${value}%` }} /></div></div>
  );
  return (
    <div className="stack">
      <PageHead title="Monitoring" actions={<Tabs value={range} onChange={setRange} items={[['1h', 'Last hour'], ['24h', 'Last 24 hours']]} />}>
        How the server is coping. TPS should stay at 20; below 15 players will notice lag.
      </PageHead>
      <div className="cols">
        <section className="panel panel-pad stack-sm">
          <div className="row spread"><h3>Server speed</h3><div className="legend"><span><i style={{ background: 'var(--brand)' }} />TPS</span></div></div>
          <Chart points={pts} series={[{ key: 'tps', label: 'TPS', color: 'var(--brand)' }]} min={0} max={20} format={(v) => v.toFixed(1)} timeFormat={tf} />
        </section>
        <section className="panel panel-pad stack-sm">
          <div className="row spread"><h3>Time per tick</h3><div className="legend"><span><i style={{ background: 'var(--warn)' }} />ms</span></div></div>
          <Chart points={pts} series={[{ key: 'mspt', label: 'MSPT', color: 'var(--warn)' }]} min={0} max={60} format={(v) => `${v.toFixed(0)} ms`} timeFormat={tf} />
        </section>
        <section className="panel panel-pad stack-sm">
          <div className="row spread"><h3>Processor</h3><div className="legend"><span><i style={{ background: 'var(--info)' }} />% of one core</span></div></div>
          <Chart points={pts} series={[{ key: 'cpu', label: 'CPU', color: 'var(--info)' }]} format={(v) => `${v.toFixed(0)}%`} timeFormat={tf} />
        </section>
        <section className="panel panel-pad stack-sm">
          <div className="row spread"><h3>Memory</h3><div className="legend"><span><i style={{ background: 'var(--brand)' }} />container</span></div></div>
          <Chart points={pts} series={[{ key: 'mem', label: 'Memory', color: 'var(--brand)' }]} format={(v) => bytes(v)} timeFormat={tf} />
        </section>
      </div>
      <section className="panel panel-pad stack-sm">
        <div className="row spread"><h3>Players online</h3><div className="legend"><span><i style={{ background: 'var(--ok)' }} />players</span></div></div>
        <Chart points={pts} series={[{ key: 'players', label: 'Players', color: 'var(--ok)' }]} format={(v) => String(Math.round(v))} height={140} timeFormat={tf} />
      </section>
      <div className="cols">
        <section className="panel panel-pad stack">
          <h3>Storage</h3>
          <Meter label="Server disk" value={pct(disk?.data)} note={`${bytes(disk?.data?.free)} free of ${bytes(disk?.data?.total)}`} />
          <Meter label="Backup disk" value={pct(disk?.backups)} note={`${bytes(disk?.backups?.free)} free`} />
          <div className="row spread"><span className="label">World size</span><b className="num">{bytes(disk?.world)}</b></div>
        </section>
        <section className="panel panel-pad stack-sm">
          <h3>Runtime</h3>
          {[['State', live?.state], ['Uptime', live?.startedAt ? duration(Date.now() - new Date(live.startedAt)) : '—'], ['Container restarts', live?.restarts], ['Memory now', bytes(live?.memUsed)], ['Heap limit', `${rt?.initMemory} – ${rt?.maxMemory}`], ['JVM profile', rt?.jvmPreset === 'aikar' ? 'Tuned (Aikar flags)' : 'Default']].map(([k, v]) => (
            <div className="row spread" key={k}><span className="muted">{k}</span><b className="num">{v ?? '—'}</b></div>))}
        </section>
      </div>
    </div>
  );
}
