import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/** Fetches a path, optionally re-polling. Keeps the last good data while refreshing. */
export function useApi(path, { every = 0, enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const load = useCallback(async () => {
    try { const d = await api(path); if (alive.current) { setData(d); setError(null); } }
    catch (e) { if (alive.current) setError(e); }
    finally { if (alive.current) setLoading(false); }
  }, [path]);
  useEffect(() => {
    alive.current = true;
    if (!enabled) return undefined;
    load();
    const t = every ? setInterval(load, every) : null;
    return () => { alive.current = false; if (t) clearInterval(t); };
  }, [load, every, enabled]);
  return { data, error, loading, reload: load };
}

export function useTheme() {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('tz.theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); } catch { return 'dark'; } });
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('tz.theme', theme); } catch { /* ignore */ } }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}
