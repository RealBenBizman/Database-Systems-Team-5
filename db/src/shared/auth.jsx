/*
   Who is signed in. Wrap the app in <AuthProvider>, then in any screen:

     const { user, loading, logout } = useAuth();
     // user = null (visitor) or { id, name, role: 'customer' | 'support' | 'manager' }

   This is for showing the right menus and screens. It is NOT security: the
   server checks the login cookie and the role on every API call.
*/
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);

export const isStaff = (user) => !!user && (user.role === 'support' || user.role === 'manager');

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On page load, ask the server whether the cookie is still good.
  useEffect(() => {
    let alive = true;
    api.get('/api/auth/me')
      .then((data) => { if (alive) setUser(data.user); })
      .catch(() => { if (alive) setUser(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const signIn = useCallback(async (url, body) => {
    const data = await api.post(url, body);
    setUser(data.user);
    return data.user;
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    loginCustomer: (email, password) => signIn('/api/auth/login', { email, password }),
    loginStaff: (email, password) => signIn('/api/auth/employee-login', { email, password }),
    register: (fields) => signIn('/api/auth/register', fields),
    logout: async () => {
      try { await api.post('/api/auth/logout'); } finally { setUser(null); }
    },
  }), [user, loading, signIn]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}