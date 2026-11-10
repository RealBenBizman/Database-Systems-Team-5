/* Page frame: promo strip, header (logo, search, account actions, then the menu for the current role),
   the page, and a footer. The home page ("/") is full width; every other page sits in a centered container. */
import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, isStaff } from './auth.jsx';
import { Button } from './ui.jsx';
import { CartIcon, SearchIcon } from './icons.jsx';
import { STORE_NAME, STORE_TAGLINE, PROMO_TEXT } from './config.js';
import { ROLE_BADGES } from './roles.js';

function Brand({ to }) {
  const [first, ...rest] = STORE_NAME.split(' ');
  return <Link to={to} className="brand">{first}<span>{rest.join('')}</span></Link>;
}

export default function Layout({ navItems }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const staff = isStaff(user);
  const wide = location.pathname === '/';
  // Customers reach the cart through the icon in the header, so it is not repeated in the menu.
  const menu = staff ? navItems : navItems.filter((item) => item.path !== '/cart');

  async function handleLogout() {
    try { await logout(); } finally { navigate(staff ? '/login' : '/'); }
  }

  function handleSearch(e) {
    e.preventDefault();
    const q = query.trim();
    // The shop page (Catalog.jsx) reads ?search= to filter the product list.
    navigate(q ? `/shop?search=${encodeURIComponent(q)}` : '/shop');
  }

  return (
    <div className="app">
      {!staff && PROMO_TEXT && <div className="promo-strip">{PROMO_TEXT}</div>}
      <header className="app-header">
        <div className="app-header-inner">
          <Brand to={staff ? '/staff' : '/'} />
          {!staff && (
            <form className="search" role="search" onSubmit={handleSearch}>
              <SearchIcon size={18} />
              <label htmlFor="site-search" className="sr-only">Search the store</label>
              <input id="site-search" type="search" placeholder="Search games, consoles, collectibles"
                value={query} onChange={(e) => setQuery(e.target.value)} />
            </form>
          )}
          <div className="header-actions" style={staff ? { marginLeft: 'auto' } : undefined}>
            {user ? (
              <>
                <span className="who">Signed in as <strong>{user.name}</strong><span className="role-badge">{ROLE_BADGES[user.role]}</span></span>
                <Button variant="ghost" onClick={handleLogout}>Sign out</Button>
              </>
            ) : (
              <>
                <Button variant="ghost" to="/login">Sign in</Button>
                <Button to="/register">Create account</Button>
              </>
            )}
            {!staff && <Link to="/cart" className="icon-btn" aria-label="Cart"><CartIcon size={22} /></Link>}
          </div>
        </div>
        <div className="header-nav">
          <nav className={`nav${staff ? ' nav-staff' : ''}`} aria-label="Main">
            {menu.map((item) => (
              <NavLink key={item.path} to={item.navTo || item.path} end={item.path === '/' || item.path === '/staff'}
                className={({ isActive }) => (isActive ? 'active' : undefined)}>
                {item.nav}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className={`app-main${wide ? ' app-main-wide' : ''}`}>
        <Outlet />
      </main>

      <footer className="app-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <Brand to={staff ? '/staff' : '/'} />
            <p>{STORE_TAGLINE}</p>
          </div>
          <div className="footer-cols">
            {!staff && (
              <>
                <div className="footer-col">
                  <strong>Shop</strong>
                  <Link to="/shop">All products</Link>
                  <Link to="/cart">Cart</Link>
                </div>
                <div className="footer-col">
                  <strong>Your account</strong>
                  <Link to="/orders">Orders</Link>
                  <Link to="/returns">Returns</Link>
                  <Link to="/rewards">Rewards</Link>
                </div>
              </>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
