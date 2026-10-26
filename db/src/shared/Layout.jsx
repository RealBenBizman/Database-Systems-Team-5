import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth, isStaff } from './auth.jsx';
import { Button } from './ui.jsx';
import { STORE_NAME } from './config.js';

export default function Layout({ navItems }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const staff = isStaff(user);

  async function handleLogout() {
    navigate('/', { replace: true });
    try { await logout(); } catch {}
    if (staff) navigate('/staff/login', { replace: true });
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <Link to={staff ? '/staff' : '/'} className="brand">{STORE_NAME.split(' ')[0]} <span>{STORE_NAME.split(' ').slice(1).join(' ')}</span></Link>
          <nav className="nav" aria-label="Main">
            {navItems.map((item) => (
              <NavLink key={item.path} to={item.navTo || item.path} end={item.path === '/' || item.path === '/staff'}
                className={({ isActive }) => (isActive ? 'active' : undefined)}>
                {item.nav}
              </NavLink>
            ))}
          </nav>
          <div className="header-actions">
            {user ? (
              <>
                <span className="who">Signed in as <strong>{user.name}</strong><span className="role-badge">{user.role}</span></span>
                <Button variant="ghost" onClick={handleLogout}>Sign out</Button>
              </>
            ) : (
              <>
                <Button variant="ghost" to="/login">Sign in</Button>
                <Button to="/register">Create account</Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <footer className="app-footer">
        {STORE_NAME} &middot; online store{!user && <> &middot; <Link to="/staff/login">Staff sign in</Link></>}
      </footer>
    </div>
  );
}
