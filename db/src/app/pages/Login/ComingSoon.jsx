// Placeholder shown until a teammate replaces the route's element in src/app/routes.jsx.
import { PageHeader, Card } from '../../../shared/ui.jsx';

export default function ComingSoon({ title, owner }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <p>This screen has not been built yet.</p>
        <p className="card-muted">Owner: {owner}. When it is ready, replace the placeholder for this route in <code>src/app/routes.jsx</code>.</p>
      </Card>
    </>
  );
}