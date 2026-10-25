import { Route, Routes } from 'react-router-dom';
import Layout from '../shared/Layout.jsx';
import ProtectedRoute from '../shared/ProtectedRoute.jsx';
import { useAuth } from '../shared/auth.jsx';
import NotFound from './pages/NotFound.jsx';
import StaffHome from './pages/StaffHome.jsx';
import { navFor, routes } from './routes.jsx';

export default function App() {
  const { user } = useAuth();
  const staffLinks = routes.filter((r) => r.summary && r.path.startsWith('/staff')
    && user && r.access.includes(user.role));

  return (
    <Routes>
      <Route element={<Layout navItems={[...(user && (user.role === 'support' || user.role === 'manager')
        ? [{ path: '/staff', nav: 'Dashboard' }] : []), ...navFor(user)]} />}>
        {routes.map((r) => (
          <Route key={r.path} path={r.path}
            element={r.access === 'public' ? r.element : <ProtectedRoute roles={r.access}>{r.element}</ProtectedRoute>} />
        ))}
        <Route path="/staff" element={<ProtectedRoute roles={['support', 'manager']}><StaffHome links={staffLinks} /></ProtectedRoute>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}