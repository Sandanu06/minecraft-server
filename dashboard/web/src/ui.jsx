import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { BRAND_YELLOW, MARK_PATH, MARK_VIEWBOX, WORDMARK_VIEWBOX, TEXT_TRANSFORM, TEXT_PATH } from './brand.js';

/** The Teczos mark on its own. */
export const Logo = ({ className }) => (
  <svg className={className} viewBox={MARK_VIEWBOX} role="img" aria-label="Teczos"><path fill={BRAND_YELLOW} d={MARK_PATH} /></svg>
);
/** Mark plus lettering; the lettering follows the text colour, so it works on dark and light themes. */
export const Wordmark = ({ className }) => (
  <svg className={className} viewBox={WORDMARK_VIEWBOX} role="img" aria-label="Teczos">
    <path fill={BRAND_YELLOW} d={MARK_PATH} />
    <g transform={TEXT_TRANSFORM}><path fill="currentColor" d={TEXT_PATH} /></g>
  </svg>
);

export const Spinner = ({ size = 17 }) => <Loader2 size={size} style={{ animation: 'spin 0.9s linear infinite' }} />;

/* ---------- toasts ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, kind = 'ok') => {
    const id = Math.random();
    setItems((l) => [...l, { id, message, kind }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), kind === 'err' ? 7000 : 3600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.kind === 'ok' ? <CheckCircle2 /> : <AlertCircle />}<span>{t.message}</span></div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- modal ---------- */
export function Modal({ title, children, onClose, wide, actions }) {
  const ref = useRef(null);
  // Callers pass a fresh onClose on every render. Keep the latest in a ref so the focus effect below runs
  // once on open; depending on onClose would re-focus the first field after every keystroke.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current?.(); };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('input, textarea, select, button.primary, button')?.focus();
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, []);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && closeRef.current?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}

/** Confirm dialog; `typed` makes the person type a word before the action unlocks. */
export function Confirm({ title, body, confirmLabel, danger, typed, busy, onConfirm, onClose }) {
  const [text, setText] = useState('');
  const ok = !typed || text.trim().toLowerCase() === typed.toLowerCase();
  return (
    <Modal title={title} onClose={onClose} actions={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className={`btn ${danger ? 'danger solid' : 'primary'}`} disabled={!ok || busy} onClick={onConfirm}>{busy && <Spinner />}{confirmLabel}</button>
    </>}>
      <div className="muted">{body}</div>
      {typed && (
        <div className="field"><label htmlFor="typed">Type <b className="mono">{typed}</b> to continue</label>
          <input id="typed" className="input" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" /></div>
      )}
    </Modal>
  );
}

export const Toggle = ({ checked, onChange, label, disabled }) => (
  <button type="button" role="switch" className="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} />
);

export function Field({ label, hint, children }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {typeof children === 'function' ? children(id) : children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export const Empty = ({ icon: Icon, title, children }) => (
  <div className="empty">{Icon && <Icon />}<b style={{ color: 'var(--text)' }}>{title}</b><div>{children}</div></div>
);

export const Tabs = ({ value, onChange, items }) => (
  <div className="tabs" role="tablist">
    {items.map(([id, label]) => <button key={id} role="tab" aria-selected={value === id} onClick={() => onChange(id)}>{label}</button>)}
  </div>
);

export const PageHead = ({ title, children, actions }) => (
  <div className="page-head"><div><h1>{title}</h1>{children && <p>{children}</p>}</div>{actions && <div className="actions">{actions}</div>}</div>
);

/* ---------- charts ---------- */
const smooth = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');

/** Tiny inline trend line. */
export function Spark({ values, color = 'var(--brand)', height = 34, min, max, area = true }) {
  const clean = values.filter((v) => v != null);
  if (clean.length < 2) return <svg width="100%" height={height} />;
  const lo = min ?? Math.min(...clean), hi = max ?? Math.max(...clean, lo + 1e-6);
  const W = 200;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, height - 3 - (((v ?? lo) - lo) / (hi - lo || 1)) * (height - 6)]);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden="true">
      {area && <path d={`${smooth(pts)} L${W} ${height} L0 ${height}Z`} fill={color} opacity=".13" />}
      <path d={smooth(pts)} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Full chart with grid, y labels and a hover read-out. */
export function Chart({ points, series, format = (v) => v, min = 0, max, height = 170, timeFormat }) {
  const [hover, setHover] = useState(null);
  const [W, setW] = useState(720);
  const ref = useRef(null);
  const wrap = useRef(null);
  useEffect(() => {
    if (!wrap.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  const H = height, padL = 52, padB = 22, padT = 8;
  const all = series.flatMap((s) => points.map((p) => p[s.key]).filter((v) => v != null));
  const hi = max ?? (all.length ? Math.max(...all) * 1.15 || 1 : 1);
  const X = (i) => padL + (i / Math.max(points.length - 1, 1)) * (W - padL - 6);
  const Y = (v) => padT + (1 - (v - min) / (hi - min || 1)) * (H - padT - padB);
  const ticks = [0, 0.5, 1].map((f) => min + (hi - min) * f);
  const fmtT = timeFormat || ((t) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(((x - padL) / (W - padL - 6)) * (points.length - 1)))));
  };
  const hp = hover != null && points[hover] ? points[hover] : null;
  if (points.length < 2) return <div ref={wrap} className="empty" style={{ height }}>Collecting data…</div>;
  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <svg ref={ref} className="chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img">
        {ticks.map((t) => <g key={t}><line className="grid" x1={padL} x2={W} y1={Y(t)} y2={Y(t)} /><text className="axis" x={padL - 8} y={Y(t) + 4} textAnchor="end">{format(t)}</text></g>)}
        <text className="axis" x={padL} y={H - 4}>{fmtT(points[0].t)}</text>
        <text className="axis" x={W - 6} y={H - 4} textAnchor="end">{fmtT(points[points.length - 1].t)}</text>
        {series.map((s) => {
          const pts = points.map((p, i) => (p[s.key] == null ? null : [X(i), Y(p[s.key])])).filter(Boolean);
          if (pts.length < 2) return null;
          return <g key={s.key}>
            {s.area !== false && <path d={`${smooth(pts)} L${pts[pts.length - 1][0]} ${H - padB} L${pts[0][0]} ${H - padB}Z`} fill={s.color} opacity=".1" />}
            <path d={smooth(pts)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </g>;
        })}
        {hp && <line x1={X(hover)} x2={X(hover)} y1={padT} y2={H - padB} stroke="var(--faint)" strokeDasharray="3 3" />}
      </svg>
      {hp && (
        <div className="panel" style={{ position: 'absolute', top: 4, left: `${Math.min(Math.max((X(hover) / W) * 100, 12), 82)}%`, transform: 'translateX(-50%)', padding: '6px 10px', fontSize: 13, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          <div className="faint">{fmtT(hp.t)}</div>
          {series.map((s) => <div key={s.key}><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: s.color, marginRight: 6 }} />{s.label}: <b>{hp[s.key] == null ? '—' : format(hp[s.key])}</b></div>)}
        </div>
      )}
    </div>
  );
}
