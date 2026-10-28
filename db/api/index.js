/*
   api/index.js - the ONE serverless function of the whole app

   Vercel's free plan allows 12 functions per deployment and counts every file in api/.
   This file answers every /api/... request and hands it to the matching file in server/
   (the real endpoints, written exactly as before). Do not add other files to api/.
   After adding, renaming or removing a file in server/, run: npm run routes
*/
const routes = require('../lib/routes.generated');
const { segmentsFromRequest, matchRoute } = require('../lib/router');
const { sendJson } = require('../lib/http');

module.exports = async function handler(req, res) {
  const match = matchRoute(routes, segmentsFromRequest(req));
  if (!match) return sendJson(res, 404, { error: 'No such API route.' });

  // Handlers expect req.query to hold the query string plus [id]-style values, as they do locally.
  const { path: _catchAll, ...query } = req.query || {};
  req.query = { ...query, ...match.params };
  try {
    return await match.route.load()(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent && !res.writableEnded) {
      return sendJson(res, 500, { error: 'Something went wrong. Please try again.' });
    }
  }
};
