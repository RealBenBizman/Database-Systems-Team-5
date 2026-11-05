/*
   Wraps a screen that needs a signed-in user (and optionally a role).
   Visitors are sent to the right sign-in page and come back afterwards.
   This hides screens; the server still checks the role on every API call.
*/
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { Spinner, EmptyState, Button } from './ui.jsx';
import { roleTitle } from './roles.js';

// "Store Manager", "Customer Support Representative or Store Manager"
const listRoles = (roles) => roles.map(roleTitle).join(' or ');

export default function ProtectedRoute({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner label="Checking your session..." />;

  if (!user) {
    const staffOnly = roles && roles.length > 0 && roles.every((r) => r === 'support' || r === 'manager');
    return <Navigate to={staffOnly ? '/staff/login' : '/login'} state={{ from: location.pathname + location.search }} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    const isStaff = user.role === 'support' || user.role === 'manager';
    return (
      <EmptyState title="This screen is not available to your role"
        action={<Button to={isStaff ? '/staff' : '/'}>{isStaff ? 'Back to your home page' : 'Back to the store'}</Button>}>
        This screen is for the {listRoles(roles)} only. You are signed in as {roleTitle(user.role)}.
        {user.role === 'support' && ' If you need this information, ask a Store Manager.'}
      </EmptyState>
    );
  }
  return children;
}