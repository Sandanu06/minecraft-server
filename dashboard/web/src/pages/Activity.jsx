import { History } from 'lucide-react';
import { useApi } from '../hooks.js';
import { ago, dateTime } from '../format.js';
import { Empty, PageHead } from '../ui.jsx';

export default function Activity() {
  const { data } = useApi('/audit', { every: 15000 });
  return (
    <div className="stack">
      <PageHead title="Activity">Everything done from this dashboard, newest first.</PageHead>
      <section className="panel table-wrap">
        {!data ? <div className="skeleton" style={{ height: 120, margin: 20 }} /> : data.entries.length === 0 ? <Empty icon={History} title="Nothing yet" /> : (
          <table className="tbl"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
            <tbody>{data.entries.map((e, i) => <tr key={i}><td title={dateTime(e.t)} className="muted num">{ago(e.t)}</td><td>{e.user}</td><td className="mono">{e.action}</td><td className="muted" style={{ wordBreak: 'break-word' }}>{e.detail}</td></tr>)}</tbody></table>)}
      </section>
    </div>
  );
}
