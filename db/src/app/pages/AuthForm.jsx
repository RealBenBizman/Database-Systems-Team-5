import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../shared/auth.jsx';
import { Button, Card, ErrorBanner, Field, Spinner } from '../../shared/ui.jsx';
import { returnTo } from '../../shared/returnTo.js';

export default function SignInForm({ kind }) {
  const staff = kind === 'staff';
  const { user, loading, loginCustomer, loginStaff } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Spinner />;
  if (user) return <Navigate to={returnTo(user, location.state?.from)} replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const signedIn = await (staff ? loginStaff : loginCustomer)(email, password);
      const back = location.state && location.state.from;
      navigate(returnTo(signedIn, back), { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Card className="auth-card" title={staff ? 'Staff sign in' : 'Sign in'}>
      <form onSubmit={handleSubmit} noValidate>
        <ErrorBanner error={error} />
        <Field label="Email" type="email" autoComplete="username" value={email}
          onChange={(e) => setEmail(e.target.value)} required />
        <Field label="Password" type="password" autoComplete="current-password" value={password}
          onChange={(e) => setPassword(e.target.value)} required />
        <Button type="submit" block loading={busy}>Sign in</Button>
      </form>
      <p className="card-muted" style={{ marginTop: 16 }}>
        {staff
          ? <>Not staff? <Link to="/login">Customer sign in</Link></>
          : <>New here? <Link to="/register" state={location.state}>Create an account</Link> &middot; <Link to="/staff/login">Staff sign in</Link></>}
      </p>
      {import.meta.env.DEV && (
        <p className="card-muted">Development hint (not shown on the live site): the seed accounts use the password <code>Password123!</code>
          {staff ? <> with <code>manager@posstore.test</code> or <code>support1@posstore.test</code>.</> : <> with <code>alice.nguyen@posstore.test</code>.</>}
        </p>
      )}
    </Card>
  );
}
