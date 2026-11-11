// The records behind a report: a title with the count, "Showing X of N", headers you can click to
// sort, and a total row that adds up the same rows. Rule: report-records-table.md.
// This is the shared version (REP-7); src/app/pages/reports/RecordsTable.jsx re-exports it, so both
// import paths work and a report that had its own copy can switch by changing one line.
//
// Props
//   title      'Products in this report'   (the count is added: 'Products in this report (43)')
//   noun       'products'                  (used in 'Showing 43 of 43 products')
//   rows       the rows to show (already filtered by the page)
//   allCount   how many rows there are before the page filters
//   columns    [{ key, label, numeric, render(row), sortValue(row), total }]
//              total (optional) is what the total row shows under that column
//   rowKey     name of the unique field in a row
//   totalLabel text in the first cell of the total row, for example 'Total of 43 products'
//   controls   optional filter fields shown above the table
//   note       optional line under the table
//   empty      text when no row matches
//   csvName    optional file name ('sales-records.csv'); adds a 'Download CSV' button that saves the rows
//              as shown (current sort, current filters). A column can set csv(row) to write something
//              other than render(row) (render may return JSX).
import { useState } from 'react';
import { Button, Card, EmptyState } from './ui.jsx';
import { toCsv } from './reportFormat.js';

const isBlank = (v) => v === null || v === undefined || v === '';

function compare(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

// Saves text as a file in the browser.
export function downloadCsv(filename, text) {
  const blob = new Blob(['\ufeff', text], { type: 'text/csv;charset=utf-8' });   // BOM: Excel reads accents right
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function RecordsTable({
  title, noun = 'records', rows, allCount, columns, rowKey = 'id',
  totalLabel, controls, note, empty = 'No records match these filters.', csvName,
}) {
  const [sort, setSort] = useState(null);   // { key, dir: 'asc' | 'desc' } or null = the order we received

  // click once: ascending, twice: descending, a third time: back to the original order
  const toggle = (key) => setSort((s) => {
    if (!s || s.key !== key) return { key, dir: 'asc' };
    if (s.dir === 'asc') return { key, dir: 'desc' };
    return null;
  });

  let shown = rows;
  const sortCol = sort && columns.find((c) => c.key === sort.key);
  if (sortCol) {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const valueOf = (row) => (sortCol.sortValue ? sortCol.sortValue(row) : row[sortCol.key]);
    shown = [...rows].sort((x, y) => {
      const a = valueOf(x);
      const b = valueOf(y);
      if (isBlank(a) && isBlank(b)) return 0;
      if (isBlank(a)) return 1;          // rows with no value always go last
      if (isBlank(b)) return -1;
      return dir * compare(a, b);
    });
  }

  const hasTotals = columns.some((c) => c.total !== undefined);
  const mark = (key) => (!sort || sort.key !== key ? '↕' : sort.dir === 'asc' ? '▲' : '▼');

  const saveCsv = () => {
    const cols = columns.map((c) => ({
      label: c.label,
      value: (row) => (c.csv ? c.csv(row) : c.sortValue ? c.sortValue(row) : row[c.key]),
    }));
    downloadCsv(csvName, toCsv(cols, shown));
  };

  return (
    <Card title={`${title} (${rows.length})`}>
      {controls && <div className="row">{controls}</div>}
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <p className="card-muted" style={{ margin: 0 }}>
          Showing {rows.length} of {allCount != null ? allCount : rows.length} {noun}. Click a column heading to sort.
        </p>
        {csvName && rows.length > 0 && <Button variant="secondary" type="button" onClick={saveCsv}>Download CSV</Button>}
      </div>
      {rows.length === 0 ? (
        <div className="table-wrap"><EmptyState title={empty} /></div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={c.numeric ? 'num' : undefined}
                    aria-sort={sort && sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(c.key)}
                      style={{
                        background: 'none', border: 0, padding: 0, margin: 0, font: 'inherit', color: 'inherit',
                        cursor: 'pointer', textAlign: c.numeric ? 'right' : 'left', fontWeight: 'inherit',
                      }}
                    >
                      {c.label} <span aria-hidden="true" style={{ opacity: sort && sort.key === c.key ? 1 : 0.4 }}>{mark(c.key)}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row, i) => (
                <tr key={row[rowKey] ?? i}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.numeric ? 'num' : undefined}>{c.render ? c.render(row) : row[c.key]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            {hasTotals && (
              <tfoot>
                <tr>
                  {columns.map((c, i) => (
                    <td
                      key={c.key}
                      className={c.numeric ? 'num' : undefined}
                      style={{ fontWeight: 700, borderTop: '2px solid var(--color-border-strong)', borderBottom: 0 }}
                    >
                      {i === 0 ? totalLabel : (c.total !== undefined ? c.total : '')}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {note && <p className="card-muted" style={{ marginTop: 8 }}>{note}</p>}
    </Card>
  );
}
