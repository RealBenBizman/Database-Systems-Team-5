/*
   lib/router.js - decide which endpoint file answers a request

   The Vercel free plan (Hobby) allows only 12 serverless functions per deployment,
   and every file in api/ counts as one. So the real endpoint files live in server/
   (same folders, same file names, same code) and the ONE file in api/ (index.js)
   picks the right one. The URLs do not change.

     /api/auth/login      -> server/auth/login.js
     /api/orders          -> server/orders/index.js  (or server/orders.js)
     /api/orders/1000001  -> server/orders/[id].js   (req.query.id = '1000001')

   lib/routes.generated.js lists every file in server/ (made by scripts/build-routes.js).
*/

// Pieces of the URL after /api/, already decoded. Returns null for anything odd.
function segmentsFromRequest(req) {
  let pathname = '';
  try {
    pathname = new URL(req.url || '', 'http://localhost').pathname;
  } catch (_) {
    pathname = '';
  }
  let parts = [];
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    parts = pathname.split('/').filter(Boolean).slice(1);
  }
  if (!parts.length) {
    // The URL was rewritten (vercel.json sends /api/... to the one function): use the
    // path that Vercel passes along as the "path" parameter.
    const q = req.query && req.query.path;
    parts = Array.isArray(q) ? q : q ? String(q).split('/') : [];
  }
  const out = [];
  for (const raw of parts) {
    let seg;
    try {
      seg = decodeURIComponent(raw);
    } catch (_) {
      return null;
    }
    if (!seg || seg === '.' || seg === '..' || seg.includes('/') || seg.includes('\\')) return null;
    out.push(seg);
  }
  return out;
}

const DYNAMIC = /^\[([A-Za-z_][A-Za-z0-9_]*)\]$/;

// routes: [{ pattern: 'orders/[id]', load: () => handler }]
// A fixed word beats [id] at the same position, reading left to right.
function matchRoute(routes, segments) {
  if (!segments) return null;
  let best = null;
  for (const route of routes) {
    const parts = route.pattern === '' ? [] : route.pattern.split('/');
    if (parts.length !== segments.length) continue;
    const params = {};
    const score = [];
    let ok = true;
    for (let i = 0; i < parts.length; i += 1) {
      const dyn = DYNAMIC.exec(parts[i]);
      if (dyn) {
        params[dyn[1]] = segments[i];
        score.push(1);
      } else if (parts[i] === segments[i]) {
        score.push(0);
      } else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (!best || compareScores(score, best.score) < 0) best = { route, params, score };
  }
  return best ? { route: best.route, params: best.params } : null;
}

function compareScores(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

module.exports = { segmentsFromRequest, matchRoute };
