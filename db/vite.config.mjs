import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/*
   Local API server (development only).

   On Vercel one function (api/index.js) answers every /api/... request and
   forwards it to the matching file in server/. Locally, "npm start" runs Vite,
   and this plugin does the same forwarding:

     /api/auth/login        -> server/auth/login.js
     /api/products          -> server/products.js  or  server/products/index.js
     /api/products/42       -> server/products/[id].js   (req.query.id = '42')

   The handler gets req.body (parsed JSON), req.query, and the plain res.
   Code in server/ and lib/ is reloaded on every request, so you can edit it
   without restarting; the database pool and the login throttle are kept.
*/
const require = createRequire(import.meta.url);
const root = process.cwd();
// The endpoint files live in server/ (the only file in api/ is the single Vercel function that
// forwards to them; see lib/router.js). Locally this plugin reads server/ directly.
const API_DIR = 'server';

function resolveApiFile(segments) {
  let dir = path.join(root, API_DIR);
  const params = {};
  for (let i = 0; i < segments.length; i++) {
    const last = i === segments.length - 1;
    const seg = decodeURIComponent(segments[i]);
    if (seg.includes('..') || seg.includes('/') || seg.includes('\\')) return null;
    const entries = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
    const exactDir = entries.find((e) => e.isDirectory() && e.name === seg);
    const exactFile = entries.find((e) => e.isFile() && e.name === `${seg}.js`);
    const dynDir = entries.find((e) => e.isDirectory() && /^\[[^\]]+\]$/.test(e.name));
    const dynFile = entries.find((e) => e.isFile() && /^\[[^\]]+\]\.js$/.test(e.name));
    if (last && exactFile) return { file: path.join(dir, exactFile.name), params };
    if (exactDir) { dir = path.join(dir, exactDir.name); continue; }
    if (last && dynFile) {
      params[dynFile.name.slice(1, -4)] = seg;
      return { file: path.join(dir, dynFile.name), params };
    }
    if (dynDir) { params[dynDir.name.slice(1, -1)] = seg; dir = path.join(dir, dynDir.name); continue; }
    return null;
  }
  const index = path.join(dir, 'index.js');
  return fs.existsSync(index) ? { file: index, params } : null;
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve(undefined);
      try { resolve(JSON.parse(text)); } catch (_) { resolve(text); } // a bad string is rejected by readBody()
    });
  });
}

function reloadProjectCode() {
  const keep = [`${path.sep}lib${path.sep}db.js`, `${path.sep}lib${path.sep}throttle.js`];
  for (const key of Object.keys(require.cache)) {
    if (key.includes('node_modules')) continue;
    const inProject = key.startsWith(path.join(root, API_DIR)) || key.startsWith(path.join(root, 'lib'));
    if (inProject && !keep.some((k) => key.endsWith(k))) delete require.cache[key];
  }
}

function localApi() {
  return {
    name: 'local-api',
    apply: 'serve',
    configureServer(server) {
      // .env.local -> process.env (Vite itself only exposes VITE_ variables to the browser)
      Object.assign(process.env, loadEnv(server.config.mode, root, ''));
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return next();

        const segments = url.pathname.split('/').filter(Boolean).slice(1);
        const found = resolveApiFile(segments);
        if (!found) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(JSON.stringify({ error: 'No such API route.' }));
        }
        try {
          reloadProjectCode();
          req.query = { ...Object.fromEntries(url.searchParams), ...found.params };
          req.body = await readJsonBody(req);
          await require(found.file)(req, res);
        } catch (err) {
          console.error(err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'Something went wrong. Please try again.' }));
          }
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localApi()],
  build: { outDir: 'dist' },
  server: { port: 5173 },
});
