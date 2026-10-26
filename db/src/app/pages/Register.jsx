import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../shared/auth.jsx';
import { Button, Card, ErrorBanner, Field, Spinner } from '../../shared/ui.jsx';
import { returnTo } from '../../shared/returnTo.js';

function check(form) {
  const errors = {};
  if (!form.firstName.trim()) errors.firstName = 'First name is required.';
  if (!form.lastName.trim()) errors.lastName = 'Last name is required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'Enter a valid email address.';
  if (form.password.length < 8) errors.password = 'Use at least 8 characters.';
  else if (!/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password)) errors.password = 'Include at least one letter and one number.';
  if (form.confirm !== form.password) errors.confirm = 'The passwords do not match.';
  return errors;
}

export default function Register() {
  const { user, loading, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Spinner />;
  if (user) return <Navigate to={returnTo(user, location.state?.from)} replace />;

  const set = (name) => (e) => setForm({ ...form, [name]: e.target.value });

  async function handleSubmit(e) {
    e.preventDefault();
    setServerError(null);
    const found = check(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      const signedIn = await register({ firstName: form.firstName, lastName: form.lastName, email: form.email, password: form.password });
      navigate(returnTo(signedIn, location.state?.from), { replace: true });
    } catch (err) {
      setServerError(err);
      setBusy(false);
    }
  }

  return (
    <Card className="auth-card" title="Create your account">
      <form onSubmit={handleSubmit} noValidate>
        <ErrorBanner error={serverError} />
        <Field label="First name" autoComplete="given-name" value={form.firstName} onChange={set('firstName')} error={errors.firstName} />
        <Field label="Last name" autoComplete="family-name" value={form.lastName} onChange={set('lastName')} error={errors.lastName} />
        <Field label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} />
        <Field label="Password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')}
          hint="At least 8 characters, with a letter and a number." error={errors.password} />
        <Field label="Confirm password" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} />
        <Button type="submit" block loading={busy}>Create account</Button>
      </form>
      <p className="card-muted" style={{ marginTop: 16 }}>Already have an account? <Link to="/login" state={location.state}>Sign in</Link></p>
    </Card>
  );
}
