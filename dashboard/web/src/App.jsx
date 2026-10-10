import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Archive, Bell, Boxes, CircleUser, FileCode2, Gauge, Globe2, History, KeyRound, LayoutDashboard, LogOut, Menu, Moon, Package, RefreshCw, ScrollText, Search, Settings as Cog, ShieldCheck, Sun, TerminalSquare, Users, UsersRound, AlertTriangle } from 'lucide-react';
import { api, setUnauthorizedHandler, restartNeededSince, clearRestartNeeded } from './api.js';
import { useApi, useTheme } from './hooks.js';
import { Logo, ToastProvider, useToast, Spinner } from './ui.jsx';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import Console from './pages/Console.jsx';
import Monitoring from './pages/Monitoring.jsx';
import Players from './pages/Players.jsx';
import Plugins from './pages/Plugins.jsx';
import Worlds from './pages/Worlds.jsx';
import Versions from './pages/Versions.jsx';
import Backups from './pages/Backups.jsx';
import Settings from './pages/Settings.jsx';
import Files from './pages/Files.jsx';
import Activity from './pages/Activity.jsx';
import Scripts from './pages/Scripts.jsx';
import Permissions from './pages/Permissions.jsx';
import Access from './pages/Access.jsx';
import Alerts from './pages/Alerts.jsx';
import Account from './pages/Account.jsx';

const ServerCtx = createContext(null);
export const useServer = () => useContext(ServerCtx);
const MeCtx = createContext({ can: () => false });
export const useMe = () => useContext(MeCtx);

// [path, label, icon, permission that unlocks the page]
const NAV = [
  ['Server', [['/', 'Overview', LayoutDashboard, 'view'], ['/console', 'Console', TerminalSquare, 'console.view'], ['/monitoring', 'Monitoring', Gauge, 'view']]],
  ['People', [['/players', 'Players', Users, 'players.view'], ['/permissions', 'Permissions', ShieldCheck, 'permissions.view']]],
  ['Content', [['/plugins', 'Plugins', Package, 'plugins.view'], ['/worlds', 'Worlds', Globe2, 'worlds.view'], ['/versions', 'Versions', Boxes, 'worlds.view']]],
  ['Automation', [['/scripts', 'Scripts', ScrollText, 'scripts.view']]],
  ['Safety', [['/backups', 'Backups', Archive, 'backups.view']]],
  ['System', [['/settings', 'Settings', Cog, 'settings.view'], ['/files', 'Config files', FileCode2, 'files.view'], ['/alerts', 'Alerts', Bell, 'alerts.manage'], ['/access', 'Access', UsersRound, 'users.manage'], ['/activity', 'Activity', History, 'audit.view']]],
];

function Palette({ items, onClose }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const nav = useNavigate();
  const shown = items.filter((x) => x.label.toLowerCase().includes(q.toLowerCase()));
  const go = (x) => { nav(x.to); onClose(); };
  return (
    <div className="scrim" style={{ placeItems: 'start center', paddingTop: '14vh' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Jump to">
        <div className="palette-in"><Search size={18} />
          <input autoFocus placeholder="Jump to a page" value={q} onChange={(e) => { setQ(e.target.value); setI(0); }}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowDown') { e.preventDefault(); setI((n) => Math.min(n + 1, shown.length - 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setI((n) => Math.max(n - 1, 0)); } if (e.key === 'Enter' && shown[i]) go(shown[i]); }} />
          <span className="kbd">Esc</span></div>
        <div className="palette-list">{shown.map((x, n) => <button key={x.to} className={n === i ? 'on' : ''} onMouseEnter={() => setI(n)} onClick={() => go(x)}><x.icon size={17} />{x.label}</button>)}
          {!shown.length && <div className="empty">No match</div>}</div>
      </div>
    </div>
  );
}

function Shell({ me, onLogout }) {
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const loc = useLocation();
  const toast = useToast();
  const can = useCallback((p) => me.permissions.includes(p), [me]);
  const overview = useApi('/overview', { every: 4000, enabled: can('view') });
  const [since, setSince] = useState(restartNeededSince());
  const [restarting, setRestarting] = useState(false);

  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => { const f = () => setSince(restartNeededSince()); window.addEventListener('tz-restart', f); return () => window.removeEventListener('tz-restart', f); }, []);
  useEffect(() => {
    const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const started = overview.data?.live?.startedAt && new Date(overview.data.live.startedAt).getTime();
    if (since && started && started > since) clearRestartNeeded();
  }, [overview.data, since]);

  const restart = async () => {
    setRestarting(true);
    try { await api('/server/restart', { method: 'POST' }); toast('Server restarted'); clearRestartNeeded(); overview.reload(); }
    catch (e) { toast(e.message, 'err'); } finally { setRestarting(false); }
  };

  const nav = useMemo(() => NAV.map(([g, items]) => [g, items.filter((it) => can(it[3]))]).filter(([, items]) => items.length), [can]);
  const paletteItems = useMemo(() => [...nav.flatMap(([, items]) => items.map(([to, label, icon]) => ({ to, label, icon }))), { to: '/account', label: 'Account and security', icon: CircleUser }], [nav]);
  const live = overview.data?.live;
  const state = live?.state || 'unknown';
  const label = { running: 'Online', starting: 'Starting', stopped: 'Offline', missing: 'Not found', unknown: 'Checking' }[state];
  const tone = state === 'running' ? 'ok' : state === 'starting' ? 'warn' : 'bad';
  const home = nav[0]?.[1][0]?.[0] || '/account';

  return (
    <MeCtx.Provider value={{ ...me, can }}>
      <ServerCtx.Provider value={{ ...overview, restart }}>
        <div className="shell">
          <aside className="rail" data-open={open}>
            <div className="brand"><Logo /><div><b>Teczos</b><span>Minecraft control</span></div></div>
            <nav className="nav" aria-label="Main">
              {nav.map(([group, items]) => (
                <div key={group}>
                  <div className="nav-group">{group}</div>
                  {items.map(([to, text, Icon]) => <NavLink key={to} to={to} end={to === '/'}><Icon />{text}</NavLink>)}
                </div>
              ))}
            </nav>
            <div className="rail-foot">
              <NavLink to="/account" className="who" title="Account and security"><CircleUser size={18} /><span><b>{me.user}</b><small>{me.roleName}</small></span></NavLink>
              <span className="row" style={{ gap: 4 }}>
                <button className="btn ghost icon" onClick={toggleTheme} aria-label="Switch theme">{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>
                <button className="btn ghost icon" onClick={onLogout} aria-label="Sign out"><LogOut size={17} /></button>
              </span>
            </div>
          </aside>
          <div className="main">
            <header className="topbar">
              <button className="btn ghost icon burger" onClick={() => setOpen((o) => !o)} aria-label="Menu"><Menu size={20} /></button>
              {can('view') && <span className={`pill ${tone}`}><i className={`dot ${state === 'running' ? 'live' : ''}`} />{label}</span>}
              {can('view') && state === 'running' && live && <span className="muted num">{live.players.online}{live.players.max ? ` / ${live.players.max}` : ''} players</span>}
              <span className="grow" />
              {overview.error && can('view') && <span className="pill bad">Connection lost</span>}
              <button className="btn small ghost" onClick={() => setPalette(true)} aria-label="Jump to a page"><Search /><span className="hide-sm">Jump to</span><span className="kbd hide-sm">Ctrl K</span></button>
            </header>
            {since > 0 && can('server.power') && (
              <div className="banner" role="status">
                <AlertTriangle size={18} /><span className="grow">Some changes need a restart to take effect.</span>
                <button className="btn primary small" onClick={restart} disabled={restarting || state !== 'running'}>{restarting ? <Spinner /> : <RefreshCw />}Restart now</button>
                <button className="btn ghost small" onClick={clearRestartNeeded}>Later</button>
              </div>
            )}
            <main className="page">
              <Routes>
                <Route path="/" element={can('view') ? <Overview /> : <Navigate to={home} replace />} />
                <Route path="/console" element={<Console />} />
                <Route path="/monitoring" element={<Monitoring />} />
                <Route path="/players" element={<Players />} />
                <Route path="/permissions" element={<Permissions />} />
                <Route path="/plugins" element={<Plugins />} />
                <Route path="/worlds" element={<Worlds />} />
                <Route path="/versions" element={<Versions />} />
                <Route path="/scripts" element={<Scripts />} />
                <Route path="/backups" element={<Backups />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/files" element={<Files />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/access" element={<Access />} />
                <Route path="/activity" element={<Activity />} />
                <Route path="/account" element={<Account onSignedOut={onLogout} />} />
                <Route path="*" element={<Navigate to={home} replace />} />
              </Routes>
            </main>
          </div>
        </div>
        {palette && <Palette items={paletteItems} onClose={() => setPalette(false)} />}
      </ServerCtx.Provider>
    </MeCtx.Provider>
  );
}

function Gate() {
  const [me, setMe] = useState(undefined); // undefined = checking, null = signed out
  const refresh = useCallback(() => api('/me').then(setMe).catch(() => setMe(null)), []);
  useEffect(() => { setUnauthorizedHandler(() => setMe(null)); refresh(); }, [refresh]);
  const logout = useCallback(async () => { await api('/logout', { method: 'POST' }).catch(() => {}); setMe(null); }, []);
  if (me === undefined) return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><Spinner size={26} /></div>;
  if (!me) return <Login onLogin={refresh} />;
  return <Shell me={me} onLogout={logout} />;
}

export default function App() { return <ToastProvider><Gate /></ToastProvider>; }
