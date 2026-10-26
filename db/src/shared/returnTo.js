export function returnTo(user, from) {
  const staff = user.role === 'support' || user.role === 'manager';
  const path = typeof from === 'string' ? from.split(/[?#]/)[0] : '';
  if (typeof from === 'string' && from.startsWith('/') && !from.startsWith('//')
    && !from.includes('\\') && !['/login', '/register', '/staff/login'].includes(path)
    && from.startsWith('/staff') === staff) return from;
  return staff ? '/staff' : '/';
}
