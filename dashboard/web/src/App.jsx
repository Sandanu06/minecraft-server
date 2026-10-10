import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Activity as ActivityIcon, Archive, Boxes, FileCode2, Gauge, Globe2, History, LayoutDashboard, LogOut, Menu, Moon, Package, RefreshCw, Settings as Cog, Sun, TerminalSquare, Users, AlertTriangle } from 'lucide-react';
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

const ServerCtx = createContext(null);
export const useServer = () => useContext(ServerCtx);

const NAV = [
  ['Server', [['/', 'Overview', LayoutDashboard], ['/console', 'Console', TerminalSquare], ['/monitoring', 'Monitoring', Gauge]]],
  ['People', [['/players', 'Players', Users]]],
  ['Content', [['/plugins', 'Plugins', Package], ['/worlds', 'Worlds', Globe2], ['/versions', 'Versions', Boxes]]],
  ['Safety', [['/backups', 'Backups', Archive]]],
  ['System', [['/settings', 'Settings', Cog], ['/files', 'Config files', FileCode2], ['/activity', 'Activity', History]]],
];

function Shell({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const loc = useLocation();
  const toast = useToast();
  const overview = useApi('/overview', { every: 4000 });
  const [since, setSince] = useState(restartNeededSince());
  const [restarting, setRestarting] = useState(false);

  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => { const f = () => setSince(restartNeededSince()); window.addEventListener('tz-restart', f); return () => window.removeEventListener('tz-restart', f); }, []);
  // A restart that happened after the change clears the reminder.
  useEffect(() => {
    const started = overview.data?.live?.startedAt && new Date(overview.data.live.startedAt).getTime();
    if (since && started && started > since) clearRestartNeeded();
  }, [overview.data, since]);

  const restart = async () => {
    setRestarting(true);
    try { await api('/server/restart', { method: 'POST' }); toast('Server restarted'); clearRestartNeeded(); overview.reload(); }
    catch (e) { toast(e.message, 'err'); } finally { setRestarting(false); }
  };

  const live = overview.data?.live;
  const state = live?.state || 'unknown';
  const label = { running: 'Online', starting: 'Starting', stopped: 'Offline', missing: 'Not found', unknown: 'Checking' }[state];
  const tone = state === 'running' ? 'ok' : state === 'starting' ? 'warn' : 'bad';

  return (
    <ServerCtx.Provider value={{ ...overview, restart }}>
      <div className="shell">
        <aside className="rail" data-open={open}>
          <div className="brand"><Logo /><div><b>Teczos</b><span>Minecraft control</span></div></div>
          <nav className="nav" aria-label="Main">
            {NAV.map(([group, items]) => (
              <div key={group}>
                <div className="nav-group">{group}</div>
                {items.map(([to, text, Icon]) => <NavLink key={to} to={to} end={to === '/'}><Icon />{text}</NavLink>)}
              </div>
            ))}
          </nav>
          <div className="rail-foot">
            <span title="Signed in">{user}</span>
            <span className="row" style={{ gap: 4 }}>
              <button className="btn ghost icon" onClick={toggleTheme} aria-label="Switch theme">{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>
              <button className="btn ghost icon" onClick={onLogout} aria-label="Sign out"><LogOut size={17} /></button>
            </span>
          </div>
        </aside>
        <div className="main">
          <header className="topbar">
            <button className="btn ghost icon burger" onClick={() => setOpen((o) => !o)} aria-label="Menu"><Menu size={20} /></button>
            <span className={`pill ${tone}`}><i className={`dot ${state === 'running' ? 'live' : ''}`} />{label}</span>
            {state === 'running' && live && <span className="muted num">{live.players.online}{live.players.max ? ` / ${live.players.max}` : ''} players</span>}
            <span className="grow" />
            {overview.error && <span className="pill bad">Connection lost</span>}
          </header>
          {since > 0 && (
            <div className="banner" role="status">
              <AlertTriangle size={18} /><span className="grow">Some changes need a restart to take effect.</span>
              <button className="btn primary small" onClick={restart} disabled={restarting || state !== 'running'}>{restarting ? <Spinner /> : <RefreshCw />}Restart now</button>
              <button className="btn ghost small" onClick={clearRestartNeeded}>Later</button>
            </div>
          )}
          <main className="page">
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/console" element={<Console />} />
              <Route path="/monitoring" element={<Monitoring />} />
              <Route path="/players" element={<Players />} />
              <Route path="/plugins" element={<Plugins />} />
              <Route path="/worlds" element={<Worlds />} />
              <Route path="/versions" element={<Versions />} />
              <Route path="/backups" element={<Backups />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/files" element={<Files />} />
              <Route path="/activity" element={<Activity />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </ServerCtx.Provider>
  );
}

function Gate() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = signed out
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api('/me').then((r) => setUser(r.user)).catch(() => setUser(null));
  }, []);
  const logout = useCallback(async () => { await api('/logout', { method: 'POST' }).catch(() => {}); setUser(null); }, []);
  if (user === undefined) return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><Spinner size={26} /></div>;
  if (!user) return <Login onLogin={setUser} />;
  return <Shell user={user} onLogout={logout} />;
}

export default function App() { return <ToastProvider><Gate /></ToastProvider>; }
