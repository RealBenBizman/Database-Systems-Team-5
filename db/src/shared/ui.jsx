/*
   Shared components. Import what you need:

     import { Button, Card, Table, Spinner, EmptyState, ErrorBanner, Field, PageHeader } from '../../shared/ui.jsx';

   Every screen should show: <Spinner/> while loading, <EmptyState/> when there
   is nothing to show, and <ErrorBanner/> when a call fails.
*/
import { Link } from 'react-router-dom';

export function Button({ variant = 'primary', loading = false, block = false, disabled, children, to, className = '', ...rest }) {
  const classes = `btn ${variant === 'secondary' ? 'btn-secondary' : variant === 'danger' ? 'btn-danger' : variant === 'ghost' ? 'btn-ghost' : ''} ${block ? 'btn-block' : ''} ${className}`.trim();
  if (to) return <Link to={to} className={classes} {...rest}>{children}</Link>;
  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading ? 'Please wait...' : children}
    </button>
  );
}

export function Card({ title, to, children, className = '' }) {
  const body = (
    <>
      {title && <h2>{title}</h2>}
      {children}
    </>
  );
  if (to) return <Link to={to} className={`card ${className}`}>{body}</Link>;
  return <section className={`card ${className}`}>{body}</section>;
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
      {children}
    </div>
  );
}

export function Spinner({ label = 'Loading...' }) {
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title = 'Nothing here yet', children, action }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorBanner({ error, children }) {
  const message = children || (error && error.message);
  if (!message) return null;
  return <div className="banner banner-error" role="alert">{message}</div>;
}

export function Banner({ kind = 'info', children }) {
  return <div className={`banner banner-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

/* A labelled input with optional hint and error text. Pass any <input> props. */
export function Field({ label, id, hint, error, as = 'input', children, ...inputProps }) {
  const inputId = id || `f-${String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const describedBy = [hint && `${inputId}-hint`, error && `${inputId}-error`].filter(Boolean).join(' ') || undefined;
  const Tag = as;
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <Tag id={inputId} aria-invalid={error ? 'true' : undefined} aria-describedby={describedBy} {...inputProps}>
        {children}
      </Tag>
      {hint && <div className="hint" id={`${inputId}-hint`}>{hint}</div>}
      {error && <div className="error" id={`${inputId}-error`}>{error}</div>}
    </div>
  );
}

/*
   <Table
     columns={[{ key: 'name', label: 'Product' }, { key: 'price', label: 'Price', numeric: true, render: (row) => `$${row.price}` }]}
     rows={items}
     rowKey="id"
     empty="No products found."
   />
*/
export function Table({ columns, rows, rowKey = 'id', empty = 'No rows to show.' }) {
  if (!rows || rows.length === 0) return <div className="table-wrap"><EmptyState title={empty} /></div>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={c.numeric ? 'num' : undefined} scope="col">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row[rowKey] ?? i}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? 'num' : undefined}>{c.render ? c.render(row) : row[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}