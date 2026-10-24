import { useState, type ReactNode } from 'react';

interface Props {
  title: string;
  sub?: ReactNode;
  className?: string;
  /** When given, the card offers a "Table" toggle so no value is tooltip-only. */
  table?: () => ReactNode;
  children: ReactNode;
}

export function Card({ title, sub, className, table, children }: Props) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`card ${className ?? ''}`}>
      <div className="card-head">
        <div>
          <h3>{title}</h3>
          {sub && <p className="sub">{sub}</p>}
        </div>
        {table && (
          <button className="link-btn" onClick={() => setAsTable((v) => !v)}>
            {asTable ? 'Chart' : 'Table'}
          </button>
        )}
      </div>
      {asTable && table ? <div className="table-wrap">{table()}</div> : children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Legend({ items }: { items: { label: string; color: string; kind?: 'line' | 'dot' | 'ref' }[] }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.label}>
          <i className={it.kind ?? 'line'} style={it.kind === 'ref' ? { color: it.color } : { background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
