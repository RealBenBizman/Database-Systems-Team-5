// Temporary page: proves the site and the API run together.
// The real shell (layout, login, menus per role) replaces this next.
import { useEffect, useState } from 'react';

export default function App() {
  const [me, setMe] = useState('loading...');

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json().then((body) => `${r.status} ${JSON.stringify(body)}`))
      .then(setMe)
      .catch((e) => setMe(`error: ${e.message}`));
  }, []);

  return (
    <main style={{ fontFamily: 'sans-serif', padding: 24 }}>
      <h1>POS Store</h1>
      <p>The site and the API are running together.</p>
      <p>GET /api/auth/me: <code>{me}</code></p>
    </main>
  );
}