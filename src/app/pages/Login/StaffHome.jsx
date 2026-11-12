// The employee shell: the landing page for support and managers.
import { useAuth } from '../../../shared/auth.jsx';
import { ROLE_BLURBS, ROLE_CAN, ROLE_CANNOT, roleTitle } from '../../../shared/roles.js';
import { Card, PageHeader } from '../../../shared/ui.jsx';

const listStyle = { margin: 0, paddingLeft: '1.2rem' };

export default function StaffHome({ links }) {
  const { user } = useAuth();
  const can = ROLE_CAN[user.role] || [];
  const cannot = ROLE_CANNOT[user.role] || [];
  return (
    <>
      <PageHeader title={`Welcome, ${user.name}`} subtitle={roleTitle(user.role)} />
      <Card title="Your role" className="role-card">
        <p className="card-muted">{ROLE_BLURBS[user.role]}</p>
        <h3>You can</h3>
        <ul style={listStyle}>
          {can.map((item) => <li key={item}>{item}</li>)}
        </ul>
        {cannot.length > 0 && (
          <>
            <h3 style={{ marginTop: '1rem' }}>You cannot</h3>
            <ul style={listStyle}>
              {cannot.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </>
        )}
      </Card>
      <div className="grid" style={{ marginTop: '1.5rem' }}>
        {links.map((l) => (
          <Card key={l.path} title={l.nav} to={l.navTo || l.path}>
            <p className="card-muted">{l.summary}</p>
          </Card>
        ))}
      </div>
    </>
  );
}