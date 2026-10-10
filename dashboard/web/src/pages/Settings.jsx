import { useEffect, useState } from 'react';
import { Gauge, Info, Save } from 'lucide-react';
import { api, markRestartNeeded } from '../api.js';
import { useApi } from '../hooks.js';
import { Field, PageHead, Spinner, Toggle, useToast } from '../ui.jsx';

const GROUPS = [
  ['Gameplay', ['motd', 'max-players', 'difficulty', 'gamemode', 'force-gamemode', 'hardcore', 'pvp', 'allow-nether', 'allow-flight', 'enable-command-block', 'spawn-monsters', 'spawn-animals', 'spawn-npcs', 'generate-structures', 'spawn-protection', 'player-idle-timeout']],
  ['Performance', ['view-distance', 'simulation-distance', 'entity-broadcast-range-percentage', 'network-compression-threshold']],
];
const NAMES = { motd: 'Server message (MOTD)', 'max-players': 'Player slots', difficulty: 'Difficulty', gamemode: 'Default game mode', 'force-gamemode': 'Force game mode on join', hardcore: 'Hardcore', pvp: 'Player vs player', 'allow-nether': 'Nether', 'allow-flight': 'Allow flight', 'enable-command-block': 'Command blocks', 'spawn-monsters': 'Monsters', 'spawn-animals': 'Animals', 'spawn-npcs': 'Villagers', 'generate-structures': 'Generate structures', 'spawn-protection': 'Spawn protection radius', 'player-idle-timeout': 'Kick idle players after (minutes, 0 = never)', 'view-distance': 'View distance (chunks)', 'simulation-distance': 'Simulation distance (chunks)', 'entity-broadcast-range-percentage': 'Entity visibility range (%)', 'network-compression-threshold': 'Network compression threshold' };
const HINTS = { 'view-distance': 'How far players see. Lower is lighter on the server.', 'simulation-distance': 'How far from players mobs and crops are active.', 'allow-flight': 'Prevents false “flying” kicks with some plugins and mods.' };

export default function Settings() {
  const { data, reload } = useApi('/settings');
  const [vals, setVals] = useState(null);
  const [rt, setRt] = useState(null);
  const [busy, setBusy] = useState('');
  const toast = useToast();
  useEffect(() => { if (data) { setVals(data.values); setRt(data.runtime); } }, [data]);
  if (!vals) return <div className="skeleton" style={{ height: 400 }} />;
  const schema = data.schema;
  const set = (k, v) => setVals((s) => ({ ...s, [k]: v }));

  const control = (k) => {
    const sc = schema[k];
    if (sc.t === 'bool') return <Toggle checked={vals[k] === 'true'} onChange={(v) => set(k, String(v))} label={NAMES[k]} />;
    if (sc.t === 'enum') return <select id={k} value={vals[k]} onChange={(e) => set(k, e.target.value)}>{sc.values.map((o) => <option key={o}>{o}</option>)}</select>;
    if (sc.t === 'int') return <input id={k} className="input" type="number" min={sc.min} max={sc.max} value={vals[k]} onChange={(e) => set(k, e.target.value)} />;
    return <input id={k} className="input" value={vals[k]} maxLength={sc.max} onChange={(e) => set(k, e.target.value)} />;
  };
  const save = async () => {
    setBusy('save');
    try { await api('/settings', { method: 'PUT', body: { values: vals } }); toast('Settings saved. Restart to apply.'); markRestartNeeded(); reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const optimize = async () => {
    setBusy('opt');
    try { const r = await api('/settings/optimize', { method: 'POST' }); setVals((s) => ({ ...s, ...r.applied })); toast('Optimized profile applied. Restart to apply.'); markRestartNeeded(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const saveRt = async () => {
    setBusy('rt');
    try { await api('/settings/runtime', { method: 'PUT', body: { initMemory: rt.initMemory, maxMemory: rt.maxMemory, jvmPreset: rt.jvmPreset } }); toast('Memory settings saved. Restart to apply.'); markRestartNeeded(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); }
  };

  return (
    <div className="stack">
      <PageHead title="Settings" actions={<button className="btn primary" onClick={save} disabled={busy === 'save'}>{busy === 'save' ? <Spinner /> : <Save />}Save changes</button>}>
        Game rules and performance. Most changes apply after a restart.
      </PageHead>

      {GROUPS.map(([group, keys]) => (
        <section className="panel" key={group}>
          <div className="panel-head"><h2>{group}</h2>{group === 'Performance' && <button className="btn small" onClick={optimize} disabled={busy === 'opt'}><Gauge />Apply optimized profile</button>}</div>
          <div className="panel-pad" style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {keys.filter((k) => schema[k]).map((k) => schema[k].t === 'bool'
              ? <div key={k} className="row spread"><label className="label" style={{ color: 'var(--text)' }}>{NAMES[k]}</label>{control(k)}</div>
              : <Field key={k} label={NAMES[k]} hint={HINTS[k]}>{() => control(k)}</Field>)}
          </div>
        </section>
      ))}

      <section className="panel">
        <div className="panel-head"><h2>Memory</h2><button className="btn small" onClick={saveRt} disabled={busy === 'rt'}>{busy === 'rt' ? <Spinner /> : <Save />}Save memory</button></div>
        <div className="panel-pad" style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          <Field label="Starting memory" hint="For example 1G">{() => <input className="input" value={rt.initMemory} onChange={(e) => setRt({ ...rt, initMemory: e.target.value })} />}</Field>
          <Field label="Maximum memory" hint="This machine is shared; 2G to 3G is a safe range.">{() => <input className="input" value={rt.maxMemory} onChange={(e) => setRt({ ...rt, maxMemory: e.target.value })} />}</Field>
          <Field label="Java profile" hint="“Tuned” uses Aikar’s flags, which cut lag spikes.">{() => <select value={rt.jvmPreset} onChange={(e) => setRt({ ...rt, jvmPreset: e.target.value })}><option value="aikar">Tuned (recommended)</option><option value="default">Default</option></select>}</Field>
        </div>
      </section>

      <section className="panel panel-pad row" style={{ alignItems: 'flex-start' }}>
        <Info color="var(--info)" style={{ flex: 'none', marginTop: 2 }} />
        <div><h3>Joining without a paid account</h3><p className="muted" style={{ marginTop: 4 }}>This server accepts launchers like TLauncher (offline mode is {data.locked['online-mode'] === 'true' ? 'off' : 'on'}), so it is locked here on purpose. Anyone can pick any name, so keep the allowlist on and add a login plugin such as AuthMe from Plugins when you want passwords.</p></div>
      </section>

      <Account />
    </div>
  );
}

function Account() {
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const ok = f.current && f.next.length >= 10 && f.next === f.again;
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api('/account/password', { method: 'POST', body: { current: f.current, next: f.next } }); toast('Password changed. Please sign in again.'); setTimeout(() => location.reload(), 1200); }
    catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <form className="panel" onSubmit={submit}>
      <div className="panel-head"><h2>Admin password</h2><button className="btn small" disabled={!ok || busy}>{busy && <Spinner />}Change password</button></div>
      <div className="panel-pad" style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        <Field label="Current password">{(id) => <input id={id} className="input" type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />}</Field>
        <Field label="New password" hint="At least 10 characters.">{(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />}</Field>
        <Field label="Repeat new password">{(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} />}</Field>
      </div>
    </form>
  );
}
