/*
  Charts for the report pages (REP-7). Plain SVG and HTML, no chart library.

  BarChart       columns, one or more series side by side (a trend by day, a count by category)
  StackedBars    columns split into parts (revenue per month by category)
  LineChart      one or more lines over time, with a "previous period" line if you pass one
  HBarChart      a ranked list: a label, a bar and the value at the tip (best sellers, late suppliers)
  SegmentedBar   one whole split into parts (stock status, returns by status)

  Every chart:
    - has a one-line `caption` that says what it shows (the page decides the words)
    - has a legend when it has two or more series, and a "Show as table" switch that lists the same numbers
    - shows a tooltip on hover and on keyboard focus
    - takes its colours from the palette below, in this fixed order, never cycled
    - says "No data" instead of drawing an empty frame

  The palette is the validated dark-surface set from the data-viz guidelines (checked against the
  card colour #131728: lightness band, chroma, colour-blind separation and 3:1 contrast all pass).
  To restyle, change VIZ_COLORS here; nothing else in the file holds a colour.
*/
import { useEffect, useRef, useState } from 'react';
import { compactNumber, formatNumber, niceScale, niceScaleSigned } from './reportFormat.js';
import './reports.css';

export const VIZ_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const vizStyle = Object.fromEntries(VIZ_COLORS.map((c, i) => [`--viz-${i + 1}`, c]));
export const seriesColor = (i) => `var(--viz-${(i % VIZ_COLORS.length) + 1})`;

const MUTED = 'var(--color-muted)';

// ---------- small helpers ----------

// the width of an element, kept up to date when the window changes
function useWidth(fallback = 640) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => { const w = Math.floor(el.getBoundingClientRect().width); if (w > 0) setWidth(w); };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, width];
}

// every Nth label so neighbours never touch
function labelStep(count, room, labels) {
  const longest = labels.reduce((m, l) => Math.max(m, String(l).length), 1);
  const need = longest * 6.6 + 14;
  return Math.max(1, Math.ceil(need / Math.max(room / Math.max(count, 1), 1)));
}

// a column with a rounded data end and a square end on the baseline
function columnPath(x, base, end, w, radius = 4) {
  const up = end <= base;
  const top = Math.min(base, end);
  const h = Math.abs(base - end);
  if (h <= 0) return '';
  const r = Math.min(radius, h / 2, w / 2);
  if (up) {
    return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`;
  }
  const bottom = top + h;
  return `M${x},${top} H${x + w} V${bottom - r} Q${x + w},${bottom} ${x + w - r},${bottom} H${x + r} Q${x},${bottom} ${x},${bottom - r} Z`;
}

const axisWidth = (ticks, fmt) => Math.max(28, ticks.reduce((m, t) => Math.max(m, fmt(t).length), 1) * 7 + 14);

// ---------- the frame every chart sits in ----------

function Legend({ items }) {
  return (
    <ul className="viz-legend" aria-label="Legend">
      {items.map((it) => (
        <li key={it.label}>
          <svg width="18" height="10" aria-hidden="true">
            {it.line
              ? <line x1="1" y1="5" x2="17" y2="5" stroke={it.color} strokeWidth="2" strokeLinecap="round" strokeDasharray={it.dashed ? '4 3' : undefined} />
              : <rect x="1" y="1" width="16" height="8" rx="2" fill={it.color} />}
          </svg>
          <span>{it.label}</span>
        </li>
      ))}
    </ul>
  );
}

function Tooltip({ tip, width }) {
  if (!tip) return null;
  const flip = tip.x > width * 0.6;
  return (
    <div className="viz-tip" role="status" style={{ left: tip.x, top: tip.y, transform: `translate(${flip ? 'calc(-100% - 14px)' : '14px'}, -50%)` }}>
      <div className="viz-tip-title">{tip.title}</div>
      {tip.rows.map((r) => (
        <div className="viz-tip-row" key={r.label}>
          {r.color && (
            <svg width="14" height="8" aria-hidden="true">
              <line x1="1" y1="4" x2="13" y2="4" stroke={r.color} strokeWidth="3" strokeLinecap="round" strokeDasharray={r.dashed ? '4 3' : undefined} />
            </svg>
          )}
          <strong>{r.value}</strong>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

function ChartFrame({ title, caption, legend, table, empty, emptyText, children }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className="viz" style={vizStyle}>
      {(title || caption) && (
        <figcaption className="viz-head">
          {title && <strong>{title}</strong>}
          {caption && <span>{caption}</span>}
        </figcaption>
      )}
      {empty ? (
        <p className="viz-empty">{emptyText || 'No data for this period.'}</p>
      ) : (
        <>
          {legend && legend.length >= 2 && <Legend items={legend} />}
          {asTable && table ? (
            <div className="viz-table table-wrap">
              <table className="table">
                <thead><tr>{table.head.map((h, i) => <th key={h} className={i > 0 ? 'num' : undefined}>{h}</th>)}</tr></thead>
                <tbody>
                  {table.rows.map((row, ri) => (
                    <tr key={ri}>{row.map((cell, ci) => <td key={ci} className={ci > 0 ? 'num' : undefined}>{cell}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : children}
          {table && (
            <button type="button" className="viz-toggle" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
              {asTable ? 'Show as chart' : 'Show as table'}
            </button>
          )}
        </>
      )}
    </figure>
  );
}

// ---------- BarChart ----------
/*
  <BarChart
    data={[{ label: 'Nov 3', revenue: 120, previous: 90 }, ...]}
    series={[{ key: 'revenue', label: 'This period' }, { key: 'previous', label: 'Previous period' }]}
    format={formatMoney}                  how a value is written in the tooltip and on the tallest bar
    axisFormat={compactNumber}            how an axis tick is written (optional)
    caption="Net revenue per day"
    title="optional bold title" />
  Up to 3 series side by side. A column is never thicker than 24px.
*/
export function BarChart({ data, series, labelKey = 'label', format = formatNumber, axisFormat = compactNumber, height = 240, title, caption, emptyText }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const rows = data || [];
  const list = (series || []).slice(0, 3);
  const values = rows.flatMap((d) => list.map((s) => Number(d[s.key]) || 0));
  const scale = niceScaleSigned(Math.min(0, ...values, 0), Math.max(...values, 0));
  const left = axisWidth(scale.ticks, axisFormat);
  const m = { top: 20, right: 8, bottom: 28, left };
  const innerW = Math.max(width - m.left - m.right, 40);
  const innerH = height - m.top - m.bottom;
  const y = (v) => m.top + innerH - ((v - scale.min) / (scale.max - scale.min)) * innerH;
  const band = innerW / Math.max(rows.length, 1);
  const gap = 2;
  const thick = Math.max(2, Math.min(24, (band * 0.7 - gap * (list.length - 1)) / list.length));
  const groupW = thick * list.length + gap * (list.length - 1);
  const step = labelStep(rows.length, innerW, rows.map((d) => d[labelKey]));

  // the tallest bar of the first series carries its value (labels stay sparse)
  let maxIndex = -1;
  if (list.length === 1) rows.forEach((d, i) => { if ((Number(d[list[0].key]) || 0) > 0 && (maxIndex < 0 || Number(d[list[0].key]) > Number(rows[maxIndex][list[0].key]))) maxIndex = i; });

  const show = (i) => {
    const d = rows[i];
    setHover({
      i, x: m.left + band * i + band / 2, y: m.top + innerH * 0.3, title: String(d[labelKey]),
      rows: list.map((s, si) => ({ label: s.label, value: format(Number(d[s.key]) || 0), color: seriesColor(si) })),
    });
  };

  return (
    <ChartFrame
      title={title} caption={caption} empty={rows.length === 0 || values.every((v) => v === 0)} emptyText={emptyText}
      legend={list.map((s, i) => ({ label: s.label, color: seriesColor(i) }))}
      table={{ head: [title || 'Period', ...list.map((s) => s.label)], rows: rows.map((d) => [d[labelKey], ...list.map((s) => format(Number(d[s.key]) || 0))]) }}
    >
      <div className="viz-plot" ref={ref}>
        <svg width={width} height={height} role="img" aria-label={caption || title || 'Bar chart'} onPointerLeave={() => setHover(null)}>
          {scale.ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'viz-axis' : 'viz-grid'} />
              <text x={m.left - 8} y={y(t)} className="viz-tick" textAnchor="end" dominantBaseline="middle">{axisFormat(t)}</text>
            </g>
          ))}
          {rows.map((d, i) => {
            const x0 = m.left + band * i + (band - groupW) / 2;
            return (
              <g key={i}>
                {hover && hover.i === i && <rect x={m.left + band * i} y={m.top} width={band} height={innerH} className="viz-wash" />}
                {list.map((s, si) => {
                  const v = Number(d[s.key]) || 0;
                  const path = columnPath(x0 + si * (thick + gap), y(0), y(v), thick);
                  return path ? <path key={s.key} d={path} fill={seriesColor(si)} /> : null;
                })}
                {i === maxIndex && (
                  <text x={Math.min(Math.max(m.left + band * i + band / 2, m.left + 14), width - m.right - 14)} y={y(Number(d[list[0].key])) - 6} className="viz-value" textAnchor="middle">
                    {format(Number(d[list[0].key]))}
                  </text>
                )}
                {i % step === 0 && (
                  <text x={m.left + band * i + band / 2} y={height - 8} className="viz-tick" textAnchor="middle">{d[labelKey]}</text>
                )}
                <rect
                  x={m.left + band * i} y={m.top} width={band} height={innerH} fill="transparent" tabIndex={0}
                  aria-label={`${d[labelKey]}: ${list.map((s) => `${s.label} ${format(Number(d[s.key]) || 0)}`).join(', ')}`}
                  onPointerMove={() => show(i)} onFocus={() => show(i)} onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
        <Tooltip tip={hover} width={width} />
      </div>
    </ChartFrame>
  );
}

// ---------- StackedBars ----------
/*
  <StackedBars
    data={[{ label: 'Oct 2026', games: 400, consoles: 900 }, ...]}
    series={[{ key: 'games', label: 'Video games' }, { key: 'consoles', label: 'Consoles' }]} ...>
  Up to 8 parts. Fold the small ones into an "Other" series before you call this.
*/
export function StackedBars({ data, series, labelKey = 'label', format = formatNumber, axisFormat = compactNumber, height = 260, title, caption, emptyText }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const rows = data || [];
  const list = (series || []).slice(0, 8);
  const totals = rows.map((d) => list.reduce((s, x) => s + Math.max(Number(d[x.key]) || 0, 0), 0));
  const scale = niceScale(Math.max(...totals, 0));
  const left = axisWidth(scale.ticks, axisFormat);
  const m = { top: 12, right: 8, bottom: 28, left };
  const innerW = Math.max(width - m.left - m.right, 40);
  const innerH = height - m.top - m.bottom;
  const y = (v) => m.top + innerH - (v / scale.max) * innerH;
  const band = innerW / Math.max(rows.length, 1);
  const thick = Math.max(4, Math.min(24, band * 0.7));
  const step = labelStep(rows.length, innerW, rows.map((d) => d[labelKey]));

  const show = (i) => {
    const d = rows[i];
    setHover({
      i, x: m.left + band * i + band / 2, y: m.top + innerH * 0.3, title: String(d[labelKey]),
      rows: [
        ...list.map((s, si) => ({ label: s.label, value: format(Number(d[s.key]) || 0), color: seriesColor(si) })).reverse(),
        { label: 'Total', value: format(totals[i]) },
      ],
    });
  };

  return (
    <ChartFrame
      title={title} caption={caption} empty={rows.length === 0 || totals.every((t) => t === 0)} emptyText={emptyText}
      legend={list.map((s, i) => ({ label: s.label, color: seriesColor(i) }))}
      table={{ head: [title || 'Period', ...list.map((s) => s.label), 'Total'], rows: rows.map((d, i) => [d[labelKey], ...list.map((s) => format(Number(d[s.key]) || 0)), format(totals[i])]) }}
    >
      <div className="viz-plot" ref={ref}>
        <svg width={width} height={height} role="img" aria-label={caption || title || 'Stacked bar chart'} onPointerLeave={() => setHover(null)}>
          {scale.ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'viz-axis' : 'viz-grid'} />
              <text x={m.left - 8} y={y(t)} className="viz-tick" textAnchor="end" dominantBaseline="middle">{axisFormat(t)}</text>
            </g>
          ))}
          {rows.map((d, i) => {
            const x0 = m.left + band * i + (band - thick) / 2;
            let acc = 0;
            const parts = [];
            list.forEach((s, si) => {
              const v = Math.max(Number(d[s.key]) || 0, 0);
              if (v <= 0) return;
              const top = y(acc + v);
              const bottom = y(acc);
              const isFirst = acc === 0;
              const isLast = acc + v === totals[i];
              // a 2px gap of card colour above every part except the one at the very bottom
              const h = bottom - top - (isFirst ? 0 : 2);
              acc += v;
              if (h <= 0) return;
              parts.push(isLast
                ? <path key={s.key} d={columnPath(x0, top + h, top, thick)} fill={seriesColor(si)} />
                : <rect key={s.key} x={x0} y={top} width={thick} height={h} fill={seriesColor(si)} />);
            });
            return (
              <g key={i}>
                {hover && hover.i === i && <rect x={m.left + band * i} y={m.top} width={band} height={innerH} className="viz-wash" />}
                {parts}
                {i % step === 0 && <text x={m.left + band * i + band / 2} y={height - 8} className="viz-tick" textAnchor="middle">{d[labelKey]}</text>}
                <rect
                  x={m.left + band * i} y={m.top} width={band} height={innerH} fill="transparent" tabIndex={0}
                  aria-label={`${d[labelKey]}: ${list.map((s) => `${s.label} ${format(Number(d[s.key]) || 0)}`).join(', ')}, total ${format(totals[i])}`}
                  onPointerMove={() => show(i)} onFocus={() => show(i)} onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
        <Tooltip tip={hover} width={width} />
      </div>
    </ChartFrame>
  );
}

// ---------- LineChart ----------
/*
  <LineChart
    data={[{ label: 'Nov 3', revenue: 120, previous: 90 }, ...]}
    series={[{ key: 'revenue', label: 'This period' }, { key: 'previous', label: 'Previous period', compare: true }]} ...>
  A `compare: true` series is drawn dashed in a quiet grey, so the current line stays the story.
  A null value leaves a gap in the line. One series gets a soft area wash under it.
*/
export function LineChart({ data, series, labelKey = 'label', format = formatNumber, axisFormat = compactNumber, height = 260, title, caption, emptyText }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const rows = data || [];
  const list = (series || []).slice(0, 4);
  const colorOf = (s, i) => (s.compare ? MUTED : seriesColor(list.filter((x, xi) => xi < i && !x.compare).length));
  const nums = rows.flatMap((d) => list.map((s) => d[s.key])).filter((v) => v !== null && v !== undefined && !Number.isNaN(Number(v))).map(Number);
  const scale = niceScaleSigned(Math.min(0, ...nums, 0), Math.max(...nums, 0));
  const left = axisWidth(scale.ticks, axisFormat);
  const m = { top: 24, right: 16, bottom: 28, left };
  const innerW = Math.max(width - m.left - m.right, 40);
  const innerH = height - m.top - m.bottom;
  const x = (i) => (rows.length <= 1 ? m.left + innerW / 2 : m.left + (i * innerW) / (rows.length - 1));
  const y = (v) => m.top + innerH - ((v - scale.min) / (scale.max - scale.min)) * innerH;
  const has = (v) => v !== null && v !== undefined && !Number.isNaN(Number(v));
  const step = labelStep(rows.length, innerW, rows.map((d) => d[labelKey]));
  const primaryCount = list.filter((s) => !s.compare).length;

  // runs of consecutive numbers, so a null breaks the line
  const runs = (key) => {
    const out = [];
    let cur = [];
    rows.forEach((d, i) => {
      if (has(d[key])) cur.push([i, Number(d[key])]);
      else if (cur.length) { out.push(cur); cur = []; }
    });
    if (cur.length) out.push(cur);
    return out;
  };

  const show = (i) => {
    const d = rows[i];
    setHover({
      i, x: x(i), y: m.top + innerH * 0.3, title: String(d[labelKey]),
      rows: list.filter((s) => has(d[s.key])).map((s, si) => ({ label: s.label, value: format(Number(d[s.key])), color: colorOf(s, list.indexOf(s)), dashed: s.compare })),
    });
  };
  const nearest = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    if (rows.length <= 1) return 0;
    return Math.min(rows.length - 1, Math.max(0, Math.round(((px - 0) / innerW) * (rows.length - 1))));
  };
  const onKey = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = Math.min(rows.length - 1, Math.max(0, (hover ? hover.i : 0) + (e.key === 'ArrowRight' ? 1 : -1)));
    show(next);
  };

  return (
    <ChartFrame
      title={title} caption={caption} empty={rows.length === 0 || nums.length === 0 || nums.every((v) => v === 0)} emptyText={emptyText}
      legend={list.map((s, i) => ({ label: s.label, color: colorOf(s, i), line: true, dashed: s.compare }))}
      table={{ head: [title || 'Period', ...list.map((s) => s.label)], rows: rows.map((d) => [d[labelKey], ...list.map((s) => (has(d[s.key]) ? format(Number(d[s.key])) : '-'))]) }}
    >
      <div className="viz-plot" ref={ref}>
        <svg width={width} height={height} role="img" aria-label={caption || title || 'Line chart'} onPointerLeave={() => setHover(null)}>
          {scale.ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'viz-axis' : 'viz-grid'} />
              <text x={m.left - 8} y={y(t)} className="viz-tick" textAnchor="end" dominantBaseline="middle">{axisFormat(t)}</text>
            </g>
          ))}
          {rows.map((d, i) => (i % step === 0 ? <text key={i} x={x(i)} y={height - 8} className="viz-tick" textAnchor="middle">{d[labelKey]}</text> : null))}

          {list.map((s, si) => {
            const color = colorOf(s, si);
            return runs(s.key).map((run, ri) => {
              const line = run.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
              const area = primaryCount === 1 && !s.compare && run.length > 1
                ? `${line} L${x(run[run.length - 1][0])},${y(0)} L${x(run[0][0])},${y(0)} Z` : null;
              return (
                <g key={`${s.key}-${ri}`}>
                  {area && <path d={area} fill={color} opacity="0.1" />}
                  <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={s.compare ? '5 4' : undefined} />
                  {run.length === 1 && <circle cx={x(run[0][0])} cy={y(run[0][1])} r="4" fill={color} className="viz-dot" />}
                </g>
              );
            });
          })}

          {/* the end of each current line: a dot and its value */}
          {list.map((s, si) => {
            if (s.compare) return null;
            const r = runs(s.key);
            if (!r.length) return null;
            const [i, v] = r[r.length - 1][r[r.length - 1].length - 1];
            return (
              <g key={`end-${s.key}`}>
                <circle cx={x(i)} cy={y(v)} r="4" fill={colorOf(s, si)} className="viz-dot" />
                {primaryCount === 1 && <text x={Math.min(x(i), width - m.right)} y={y(v) - 10} className="viz-value" textAnchor="end">{format(v)}</text>}
              </g>
            );
          })}

          {hover && (
            <g pointerEvents="none">
              <line x1={x(hover.i)} x2={x(hover.i)} y1={m.top} y2={m.top + innerH} className="viz-cross" />
              {list.map((s, si) => (has(rows[hover.i][s.key])
                ? <circle key={s.key} cx={x(hover.i)} cy={y(Number(rows[hover.i][s.key]))} r="4" fill={colorOf(s, si)} className="viz-dot" /> : null))}
            </g>
          )}
          <rect
            x={m.left} y={m.top} width={innerW} height={innerH} fill="transparent" tabIndex={0}
            aria-label={`${caption || title || 'Line chart'}. Use the left and right arrow keys to read each point.`}
            onPointerMove={(e) => show(nearest(e))} onFocus={() => show(hover ? hover.i : 0)} onBlur={() => setHover(null)} onKeyDown={onKey}
          />
        </svg>
        <Tooltip tip={hover} width={width} />
      </div>
    </ChartFrame>
  );
}

// ---------- HBarChart ----------
/*
  <HBarChart
    rows={[{ label: 'Pocket Puzzle Club', value: 42, note: '3 left' }, ...]}
    format={formatNumber} color={0} caption="Best sellers by units" />
  Plain HTML rows: a label, a bar and the value at the tip. `note` is a small grey line under the label.
*/
export function HBarChart({ rows, format = formatNumber, color = 0, title, caption, emptyText, limit }) {
  const list = (rows || []).slice(0, limit || rows?.length || 0);
  const max = Math.max(...list.map((r) => Number(r.value) || 0), 0);
  return (
    <ChartFrame
      title={title} caption={caption} empty={list.length === 0} emptyText={emptyText}
      table={{ head: [title || 'Item', 'Value'], rows: list.map((r) => [r.label, format(Number(r.value) || 0)]) }}
    >
      <ul className="viz-hbars" style={vizStyle}>
        {list.map((r, i) => {
          const v = Number(r.value) || 0;
          const pct = max > 0 ? (v / max) * 100 : 0;
          return (
            <li key={`${r.label}-${i}`} aria-label={`${r.label}: ${format(v)}`}>
              <span className="viz-hbar-label" title={r.label}>
                <span className="viz-hbar-name">{r.label}</span>
                {r.note && <small>{r.note}</small>}
              </span>
              <span className="viz-hbar-track">
                <span className="viz-hbar" style={{ width: `${Math.max(pct * 0.86, v > 0 ? 0.8 : 0)}%`, background: seriesColor(typeof r.color === 'number' ? r.color : color) }} />
                <span className="viz-hbar-value">{format(v)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </ChartFrame>
  );
}

// ---------- SegmentedBar ----------
/*
  <SegmentedBar
    parts={[{ label: 'In stock', value: 30 }, { label: 'Low', value: 8, color: 3 }, { label: 'Out', value: 6, color: 'muted' }]}
    format={formatNumber} caption="Products by stock status" />
  One whole split into parts: widths follow the values. A part's share is printed inside it when it fits.
  color: a palette position (0 to 7) or 'muted' (grey). Default: its own position in the list.
*/
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export function SegmentedBar({ parts, format = formatNumber, title, caption, emptyText, unit = '' }) {
  const [ref, width] = useWidth(520);
  const [hover, setHover] = useState(null);
  const list = (parts || []).filter((p) => Number(p.value) > 0);
  const total = list.reduce((s, p) => s + Number(p.value), 0);
  const all = parts || [];
  const hexOf = (p, i) => (p.color === 'muted' ? '#6b7394' : VIZ_COLORS[(typeof p.color === 'number' ? p.color : all.indexOf(p)) % VIZ_COLORS.length]);
  const cssOf = (p) => (p.color === 'muted' ? '#6b7394' : seriesColor(typeof p.color === 'number' ? p.color : all.indexOf(p)));
  const gaps = (list.length - 1) * 2;
  const avail = Math.max(width - gaps, 1);

  return (
    <ChartFrame
      title={title} caption={caption} empty={total === 0} emptyText={emptyText}
      legend={all.map((p) => ({ label: p.label, color: cssOf(p) }))}
      table={{ head: [title || 'Part', 'Value', 'Share'], rows: all.map((p) => [p.label, `${format(Number(p.value) || 0)}${unit}`, total ? `${((Number(p.value) || 0) / total * 100).toFixed(1)}%` : '-']) }}
    >
      <div className="viz-plot" ref={ref}>
        <div className="viz-seg" role="img" aria-label={`${caption || title || 'Split'}: ${list.map((p) => `${p.label} ${format(p.value)}`).join(', ')}`}>
          {list.map((p) => {
            const w = (Number(p.value) / total) * avail;
            const share = `${Math.round((Number(p.value) / total) * 100)}%`;
            const dark = luminance(hexOf(p)) > 0.3;
            return (
              <span
                key={p.label} className="viz-seg-part" tabIndex={0}
                style={{ width: w, background: cssOf(p), color: dark ? '#0b0b0b' : '#ffffff' }}
                aria-label={`${p.label}: ${format(p.value)}${unit}, ${share}`}
                onPointerEnter={() => setHover({ x: 0, y: 0, p })} onPointerLeave={() => setHover(null)}
                onFocus={() => setHover({ x: 0, y: 0, p })} onBlur={() => setHover(null)}
              >
                {w >= 44 ? share : ''}
              </span>
            );
          })}
        </div>
        <p className="viz-seg-read" aria-live="polite">
          {hover ? <><strong>{format(hover.p.value)}{unit}</strong> {hover.p.label} ({Math.round((Number(hover.p.value) / total) * 100)}% of {format(total)}{unit})</> : ' '}
        </p>
      </div>
    </ChartFrame>
  );
}
