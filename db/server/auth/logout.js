//POST api/auth/logout.js -> clears the log in cookie
const { route } = require('../../lib/http')
const { clearAuthCookie } = require('../../lib/auth');

module.exports = route({
    POST: (req, res) => {
        clearAuthCookie(res);
        return { ok: true };
    },
});