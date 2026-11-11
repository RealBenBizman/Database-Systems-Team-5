// The Reports hub (REP-7): one page that lists every report and the question it answers.
// A report appears as a live link as soon as its route exists in src/app/routes.jsx, so nobody has to
// edit this file when they add theirs; until then its card says "In progress".
// (routes.jsx imports this file and this file reads routes.jsx; that is fine because routes is only
// used while the page renders, after both files have loaded.)
import { Link } from 'react-router-dom';
import { Card, PageHeader } from '../../../shared/ui.jsx';
import '../../../shared/reports.css';
import { routes } from '../../routes.jsx';

// The four reports of Checkpoint 3, in the order a manager usually asks the questions.
const REPORTS = [
  { path: '/staff/reports/sales', title: 'Sales report', question: 'How much did we sell, how much did we keep, and what sells best?', part: 'Part 2' },
  { path: '/staff/reports/inventory', title: 'Inventory report', question: 'What do we have, what is about to run out, and which suppliers are late?', part: 'Part 4' },
  { path: '/staff/reports/rewards', title: 'Customer report', question: 'Who comes back, and do loyalty members spend more?', part: 'Part 3' },
  { path: '/staff/reports/returns', title: 'Returns report', question: 'What gets sent back, why, and how fast do we refund it?', part: 'Part 3' },
];

export default function ReportsHub() {
  const live = new Map(routes.filter((r) => r.path.startsWith('/staff/reports/')).map((r) => [r.path, r]));
  return (
    <>
      <PageHeader title="Reports" subtitle="Pick the question you want answered. Every report has the same filters and ends with the records behind its numbers." />
      <div className="grid">
        {REPORTS.map((rep) => {
          const route = live.get(rep.path);
          if (!route) {
            return (
              <Card key={rep.path} title={rep.title} className="report-soon">
                <p className="card-muted">{rep.question}</p>
                <p className="card-muted"><strong>In progress</strong> ({rep.part}). It will show up here when it is ready.</p>
              </Card>
            );
          }
          return (
            <Card key={rep.path} title={route.nav || rep.title} to={rep.path}>
              <p className="card-muted">{rep.question}</p>
              <p className="card-muted">{route.summary}</p>
            </Card>
          );
        })}
      </div>
      <section className="insights" style={{ marginTop: 'var(--space-6)' }} aria-label="How to read the reports">
        <h2>How to read the reports</h2>
        <ul>
          <li className="neutral"><span className="mark" aria-hidden="true">•</span><span>Green means good news and red means watch out. The words next to the colour always say which way a number moved.</span></li>
          <li className="neutral"><span className="mark" aria-hidden="true">•</span><span>Each number is compared with the previous period (the same number of days just before) or with the same dates last year.</span></li>
          <li className="neutral"><span className="mark" aria-hidden="true">•</span><span>The table at the bottom of every report lists the records behind the numbers, and its total row matches the cards above it.</span></li>
          <li className="neutral"><span className="mark" aria-hidden="true">•</span><span>Weeks start on Monday. Only completed sales count, and removed records are left out.</span></li>
        </ul>
      </section>
    </>
  );
}
