// The employee shell: the landing page for support and managers.
import { useAuth } from '../../shared/auth.jsx';
import { Card, PageHeader } from '../../shared/ui.jsx';

const BLURB = {
  support: 'You can review inventory and low-stock alerts, and handle customer returns (approve, deny and refund).',
  manager: 'You can do everything support can, plus manage products, prices, suppliers and reports.',
};

export default function StaffHome({ links }) {
  const { user } = useAuth();
  return (
    <>
      <PageHeader title={`Welcome, ${user.name}`} subtitle={BLURB[user.role]} />
      <div className="grid">
        {links.map((l) => (
          <Card key={l.path} title={l.nav} to={l.navTo || l.path}>
            <p className="card-muted">{l.summary}</p>
          </Card>
        ))}
      </div>
    </>
  );
}