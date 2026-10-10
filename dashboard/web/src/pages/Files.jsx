import { useEffect, useState } from 'react';
import { FileCode2, Save } from 'lucide-react';
import { api, markRestartNeeded } from '../api.js';
import { useApi } from '../hooks.js';
import { PageHead, Spinner, useToast } from '../ui.jsx';

export default function Files() {
  const { data } = useApi('/files');
  const [file, setFile] = useState('');
  const [text, setText] = useState('');
  const [orig, setOrig] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!file) return;
    api(`/files/content?path=${encodeURIComponent(file)}`).then((r) => { setText(r.content); setOrig(r.content); }).catch((e) => toast(e.message, 'err'));
  }, [file]);
  useEffect(() => { if (data && !file) setFile(data.files[0] || ''); }, [data]);

  const save = async () => {
    setBusy(true);
    try { await api('/files/content', { method: 'PUT', body: { path: file, content: text } }); setOrig(text); toast('Saved. A .bak copy of the old file was kept.'); markRestartNeeded(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const groups = data ? Object.entries(data.files.reduce((a, f) => { const g = f.includes('/') ? f.split('/')[0] : 'server'; (a[g] ||= []).push(f); return a; }, {})) : [];

  return (
    <div className="stack">
      <PageHead title="Config files" actions={<button className="btn primary" onClick={save} disabled={busy || text === orig || !file}>{busy ? <Spinner /> : <Save />}Save file</button>}>
        Edit any server or plugin configuration directly. Most files are read at start-up, so restart after saving.
      </PageHead>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 280px) minmax(0, 1fr)', gap: 20 }} className="files-grid">
        <section className="panel" style={{ alignSelf: 'start', maxHeight: '70vh', overflow: 'auto' }}>
          {groups.map(([g, fs]) => (
            <div key={g}><div className="nav-group" style={{ padding: '14px 18px 4px' }}>{g}</div>
              {fs.map((f) => <button key={f} className="btn ghost" style={{ width: '100%', justifyContent: 'flex-start', borderRadius: 0, color: f === file ? 'var(--text)' : undefined, background: f === file ? 'var(--brand-wash)' : undefined }} onClick={() => (text === orig || confirm('Discard unsaved changes?')) && setFile(f)}><FileCode2 />{f.split('/').slice(1).join('/') || f}</button>)}</div>))}
        </section>
        <section className="stack-sm">
          <div className="mono muted">{file}{text !== orig && <span className="pill warn" style={{ marginLeft: 10 }}>Unsaved</span>}</div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={26} spellCheck="false" aria-label="File contents" style={{ minHeight: '60vh' }} />
        </section>
      </div>
    </div>
  );
}
