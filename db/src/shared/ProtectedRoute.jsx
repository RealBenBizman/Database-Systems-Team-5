import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { Spinner, EmptyState, Button } from './ui.jsx';

export default function ProtectedRoute({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner label="Checking your session..." />;

  if (!user) {
    const staffOnly = roles && roles.length > 0 && roles.every((r) => r === 'support' || r === 'manager');
    return <Navigate to={staffOnly ? '/staff/login' : '/login'} state={{ from: location.pathname + location.search }} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return (
      <EmptyState title="You do not have access to this page"
        action={<Button to={user.role === 'customer' ? '/' : '/staff'}>Go back</Button>}>
        Your account ({user.role}) cannot open this screen.
      </EmptyState>
    );
  }
  return children;
}