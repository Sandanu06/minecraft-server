import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Pause, Play } from 'lucide-react';
import { api } from '../api.js';
import { useMe } from '../App.jsx';
import { PageHead, useToast } from '../ui.jsx';

const QUICK = ['list', 'tps', 'save-all', 'whitelist list', 'difficulty', 'time set day', 'weather clear'];
const cls = (l) => (/\bWARN\b|WARN]/.test(l) ? 'warn' : /ERROR|Exception|\tat /.test(l) ? 'err' : /joined the game|left the game/.test(l) ? 'join' : l.startsWith('> ') ? 'cmd' : '');

export default function Console() {
  const [lines, setLines] = useState([]);
  const [filter, setFilter] = useState('');
  const [follow, setFollow] = useState(true);
  const [chatOnly, setChatOnly] = useState(false);
  const me = useMe();
  const canRun = me.can('console.run') || me.can('console.safe');
  const [paused, setPaused] = useState(false);
  const [cmd, setCmd] = useState('');
  const [history, setHistory] = useState([]);
  const [hi, setHi] = useState(-1);
  const [conn, setConn] = useState('connecting');
  const out = useRef(null);
  const pausedRef = useRef(false);
  const toast = useToast();
  pausedRef.current = paused;

  useEffect(() => {
    const es = new EventSource('/api/logs/stream?tail=300');
    es.onopen = () => setConn('live');
    es.onmessage = (e) => { if (!pausedRef.current) setLines((l) => [...l.slice(-1500), JSON.parse(e.data)]); };
    es.addEventListener('end', () => setConn('ended'));
    es.onerror = () => setConn('reconnecting');
    return () => es.close();
  }, []);

  const base = chatOnly ? lines.filter((l) => /: <\w{3,16}> /.test(l) || /(joined|left) the game/.test(l)) : lines;
  const shown = filter ? base.filter((l) => l.toLowerCase().includes(filter.toLowerCase())) : base;
  useEffect(() => { if (follow && out.current) out.current.scrollTop = out.current.scrollHeight; }, [shown.length, follow]);

  const send = async (text) => {
    const command = (text ?? cmd).trim();
    if (!command) return;
    setHistory((h) => [command, ...h.filter((x) => x !== command)].slice(0, 50)); setHi(-1); setCmd('');
    setLines((l) => [...l, `> ${command}`]);
    try { const r = await api('/console', { method: 'POST', body: { command } }); if (r.output) setLines((l) => [...l, ...r.output.split('\n')]); }
    catch (e) { toast(e.message, 'err'); }
  };
  const onKey = (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); const i = Math.min(hi + 1, history.length - 1); if (history[i]) { setHi(i); setCmd(history[i]); } }
    if (e.key === 'ArrowDown') { e.preventDefault(); const i = hi - 1; setHi(i); setCmd(i >= 0 ? history[i] : ''); }
  };

  return (
    <div className="stack">
      <PageHead title="Console">Live server output. Commands run with full operator rights.</PageHead>
      <div className="term">
        <div className="term-bar">
          <span className={`pill ${conn === 'live' ? 'ok' : 'warn'}`} style={{ background: 'transparent' }}><i className={`dot ${conn === 'live' ? 'live' : ''}`} />{conn === 'live' ? 'Live' : conn}</span>
          <input className="input" placeholder="Filter output" aria-label="Filter output" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <span style={{ flex: 1 }} />
          <button className="btn small ghost" style={{ color: chatOnly ? 'var(--brand)' : '#d6d8de' }} onClick={() => setChatOnly((c) => !c)}>Chat only</button>
          <button className="btn small ghost" style={{ color: '#d6d8de' }} onClick={() => setPaused((p) => !p)}>{paused ? <Play /> : <Pause />}{paused ? 'Resume' : 'Pause'}</button>
          <button className="btn small ghost" style={{ color: follow ? 'var(--brand)' : '#d6d8de' }} onClick={() => setFollow((f) => !f)}><ArrowDownToLine />Follow</button>
        </div>
        <div className="term-out" ref={out} onWheel={() => follow && out.current && out.current.scrollHeight - out.current.scrollTop - out.current.clientHeight > 80 && setFollow(false)}>
          {shown.map((l, i) => <div key={i} className={cls(l)}>{l}</div>)}
          {!shown.length && <div style={{ color: '#6c7280' }}>Waiting for output…</div>}
        </div>
        {canRun ? <form className="term-in" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <span>›</span>
          <input value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={onKey} placeholder="Type a command, for example list" aria-label="Command" autoComplete="off" spellCheck="false" />
          <button className="btn primary small" disabled={!cmd.trim()}>Run</button>
        </form> : <div className="term-in"><span className="faint" style={{ color: '#6c7280' }}>Your role can read the console but not run commands.</span></div>}
      </div>
      {canRun && <div className="chips">{QUICK.map((q) => <button key={q} className="chip" onClick={() => send(q)}>{q}</button>)}</div>}
    </div>
  );
}
