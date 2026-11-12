/*
  The report toolkit (REP-7). Import everything a report page needs from this one file:

    import {
      ReportPage, ReportSection, FilterBar, DateRangeFilter, ChoiceFilter, SelectFilter, useReportFilters,
      KpiGrid, KpiCard, InsightsPanel, changeInsight,
      BarChart, LineChart, StackedBars, HBarChart, SegmentedBar,
      RecordsTable, formatMoney, formatNumber, formatPercent, changeInfo,
    } from '../../../shared/reports.jsx';

  A report page, top to bottom (the layout every report guide asks for):

    <ReportPage title="Sales report" subtitle="...">
      <FilterBar>  <DateRangeFilter .../>  <ChoiceFilter label="Compare" .../>  ...  </FilterBar>
      <KpiGrid>    <KpiCard label value change previous .../> x6   </KpiGrid>
      <InsightsPanel insights={[...]} />                  "What this means", 3 to 5 sentences
      <ReportSection title="Trend" caption="..."> <LineChart .../> </ReportSection>
      ...more sections...
      <RecordsTable .../>                                  the records behind the numbers (always last)
    </ReportPage>

  The rules these pieces keep: colour follows meaning and the words are always printed; every chart has a
  one-line caption; the filters live in the page URL; weeks start on Monday (lib/reportPeriods.js).
*/
import { Link, useSearchParams } from 'react-router-dom';
import { useCallback, useMemo } from 'react';
import { PageHeader } from './ui.jsx';
import {
  PRESETS, activePreset, changeInfo, compareLabel, presetRange, rangeProblem, readFilters, writeFilters,
} from './reportFormat.js';
import './reports.css';

export * from './reportFormat.js';
export * from './charts.jsx';
export { default as RecordsTable, downloadCsv } from './RecordsTable.jsx';

// ---------- page frame ----------

// Title, subtitle and a link back to the Reports hub.
export function ReportPage({ title, subtitle, children }) {
  return (
    <>
      <Link to="/staff/reports" className="report-back">&larr; All reports</Link>
      <PageHeader title={title} subtitle={subtitle} />
      {children}
    </>
  );
}

// A titled block of the page with an optional one-line caption under the title.
export function ReportSection({ title, caption, children }) {
  return (
    <section className="report-section">
      <h2>{title}</h2>
      {caption && <p className="report-caption">{caption}</p>}
      {children}
    </section>
  );
}

// ---------- KPI cards ----------

export function KpiGrid({ children }) {
  return <div className="kpi-grid">{children}</div>;
}

/*
  <KpiCard label="Net revenue" value="$12,345.00"
           change={changeInfo({ current: 12345, previous: 11000, compare })}
           previous="$11,000.00" hint="After discounts and refunds, before tax." />
  `change` is what changeInfo() returns (its words, arrow and colour). Leave it out when the page is not
  comparing (compare = none). `previous` is the earlier value, already formatted.
*/
export function KpiCard({ label, value, change, previous, hint }) {
  const tone = change ? change.tone : 'neutral';
  return (
    <div className={`kpi kpi-${tone}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {change && (
        <div className="kpi-change">
          {change.arrow && <span className="arrow" aria-hidden="true">{change.arrow}</span>}
          <span>{change.text}</span>
        </div>
      )}
      {previous !== undefined && previous !== null && change && change.direction !== 'none' && <div className="kpi-prev">Before: {previous}</div>}
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  );
}

// ---------- "What this means" ----------

/*
  <InsightsPanel insights={[{ tone: 'good', text: '...' }, 'a plain sentence', ...]} />
  tone: 'good' | 'bad' | 'neutral' (the mark in front of the sentence, with a word for screen readers).
  Keep it to 3 to 5 short sentences that say what the numbers mean in plain words.
*/
const TONE_MARK = { good: '✓', bad: '!', neutral: '•' };
const TONE_WORD = { good: 'Good news: ', bad: 'Watch out: ', neutral: '' };

export function InsightsPanel({ insights, title = 'What this means' }) {
  const items = (insights || []).filter(Boolean).map((i) => (typeof i === 'string' ? { tone: 'neutral', text: i } : i));
  return (
    <section className="insights" aria-label={title}>
      <h2>{title}</h2>
      {items.length === 0 ? (
        <p className="none">There is not enough data in this period to say anything useful yet.</p>
      ) : (
        <ul>
          {items.map((it, i) => (
            <li key={i} className={it.tone || 'neutral'}>
              <span className="mark" aria-hidden="true">{TONE_MARK[it.tone] || TONE_MARK.neutral}</span>
              <span><span className="sr-only">{TONE_WORD[it.tone] || ''}</span>{it.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/*
  One sentence about a change, ready for the insights list, or null when there is nothing to compare.
    changeInsight({ label: 'Net revenue', current: 1348, previous: 1200, format: formatMoney, compare })
    -> { tone: 'good', text: 'Net revenue is up 12.3% on the previous period ($1,348.00 now, $1,200.00 before).' }
  Same options as changeInfo, plus label and format.
*/
export function changeInsight({ label, format = String, ...opts }) {
  const c = changeInfo(opts);
  if (c.direction === 'none') return null;
  const basis = compareLabel(opts.compare);
  const now = format(opts.current);
  const before = format(opts.previous);
  if (c.direction === 'flat') return { tone: 'neutral', text: `${label} did not change on ${basis} (${now}).` };
  if (/^New:/.test(c.text)) return { tone: 'neutral', text: `${label} is ${now}; there was nothing to compare with in ${basis}.` };
  const words = c.text.replace(/ on the (previous period|same period last year)$/, '').toLowerCase();
  return { tone: c.tone, text: `${label} is ${words} on ${basis} (${now} now, ${before} before).` };
}

// ---------- filters ----------

// All the filter controls in one row above the content they control.
export function FilterBar({ children }) {
  return <div className="filter-bar" role="group" aria-label="Report filters">{children}</div>;
}

/*
  const [filters, setFilters] = useReportFilters({ from, to, compare: 'previous', groupBy: 'day', category: '' });
  - filters      the current values (from the page URL, or the default for a key that is not in the URL)
  - setFilters   setFilters({ category: '3' }) changes those keys and writes them to the URL
  A value equal to its default is left out of the URL, so a shared link stays short. Only the keys in the
  defaults object are read, so nothing else in the URL can reach the report.
  Pass the defaults object from a constant or useMemo; the page reloads its data when `filters` changes.
*/
export function useReportFilters(defaults) {
  const [params, setParams] = useSearchParams();
  const key = JSON.stringify(defaults);
  // `filters` only changes identity when the URL really changes, so it is safe in a useEffect list
  const query = params.toString();
  const filters = useMemo(() => readFilters(new URLSearchParams(query), JSON.parse(key)), [query, key]);
  const setFilters = useCallback((patch) => {
    setParams((current) => writeFilters({ ...readFilters(current, JSON.parse(key)), ...patch }, JSON.parse(key), current), { replace: true });
  }, [setParams, key]);
  return [filters, setFilters];
}

/*
  <DateRangeFilter from={filters.from} to={filters.to} onChange={setFilters} />
  Preset buttons (last 7 days ... year to date) and two date fields. onChange gets { from, to }.
  A start date after the end date is passed on too (so the field shows what was typed) and the message
  says why it cannot run. Pages should check rangeProblem(from, to) and skip the fetch while it is not ''.
*/
export function DateRangeFilter({ from, to, onChange, today }) {
  const active = activePreset(from, to, today);
  const bad = Boolean(rangeProblem(from, to));
  const problem = rangeProblem(from, to);
  return (
    <div className="filter-group">
      <span className="filter-label" id="range-label">Date range</span>
      <div className="filter-choices" role="group" aria-labelledby="range-label">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" className="filter-choice" aria-pressed={active === p.id}
            onClick={() => onChange(presetRange(p.id, today))}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="filter-dates">
        <label className="sr-only" htmlFor="range-from">From</label>
        <input id="range-from" type="date" value={from} max={to || undefined} aria-invalid={bad || undefined}
          onChange={(e) => e.target.value && onChange({ from: e.target.value, to })} />
        <span className="dash" aria-hidden="true">to</span>
        <label className="sr-only" htmlFor="range-to">To</label>
        <input id="range-to" type="date" value={to} min={from || undefined} aria-invalid={bad || undefined}
          onChange={(e) => e.target.value && onChange({ from, to: e.target.value })} />
      </div>
      {bad && <p className="filter-error" role="alert">{problem}</p>}
    </div>
  );
}

/*
  <ChoiceFilter label="Compare with" value={filters.compare} onChange={(v) => setFilters({ compare: v })}
    options={[{ value: 'previous', label: 'Previous period' }, { value: 'lastyear', label: 'Same period last year' }, { value: 'none', label: 'No comparison' }]} />
  A short row of buttons for a choice of two to four values (compare, group by).
*/
export function ChoiceFilter({ label, value, options, onChange }) {
  const id = `choice-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="filter-group">
      <span className="filter-label" id={id}>{label}</span>
      <div className="filter-choices" role="group" aria-labelledby={id}>
        {options.map((o) => (
          <button key={o.value} type="button" className="filter-choice" aria-pressed={String(value) === String(o.value)} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/*
  <SelectFilter label="Category" value={filters.category} onChange={(v) => setFilters({ category: v })}
    options={[{ value: '', label: 'All categories' }, ...categories.map((c) => ({ value: String(c.id), label: c.name }))]} />
*/
export function SelectFilter({ label, value, options, onChange }) {
  const id = `select-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="filter-group">
      <label className="filter-label" htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// The standard options for the two filters every report has.
export const COMPARE_OPTIONS = [
  { value: 'previous', label: 'Previous period' },
  { value: 'lastyear', label: 'Same period last year' },
  { value: 'none', label: 'No comparison' },
];
export const GROUP_OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];
