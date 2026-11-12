// The one sign-in page. Customers and staff use the same form; the server finds out which kind of account it is.
import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, isStaff } from '../../../shared/auth.jsx';
import { Button, Card, ErrorBanner, Field, Spinner } from '../../../shared/ui.jsx';

export default function SignInForm() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Spinner />;
  if (user) return <Navigate to={isStaff(user) ? '/staff' : '/'} replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const signedIn = await login(email, password);
      const back = location.state && location.state.from;
      navigate(back || (isStaff(signedIn) ? '/staff' : '/'), { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Card className="auth-card" title="Sign in">
      <p className="card-muted">Customers and staff sign in here.</p>
      <form onSubmit={handleSubmit} noValidate>
        <ErrorBanner error={error} />
        <Field label="Email" type="email" autoComplete="username" value={email}
          onChange={(e) => setEmail(e.target.value)} required />
        <Field label="Password" type="password" autoComplete="current-password" value={password}
          onChange={(e) => setPassword(e.target.value)} required />
        <Button type="submit" block loading={busy}>Sign in</Button>
      </form>
      <p className="card-muted" style={{ marginTop: 16 }}>
        New here? <Link to="/register">Create an account</Link>
      </p>
      {import.meta.env.DEV && (
        <p className="card-muted">Development hint (not shown on the live site): the seed accounts share one password, which is in the header of <code>seed.sql</code>. Use <code>manager@posstore.test</code> (Store Manager), <code>support1@posstore.test</code> (Customer Support Representative) or <code>alice.nguyen@posstore.test</code> (Customer).</p>
      )}
    </Card>
  );
}
