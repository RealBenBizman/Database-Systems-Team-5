/*
    lib/fields.js - more field checks for the manager screens (prices, dates, codes, search text)

    Same idea as lib/validate.js: each helper reads one value, returns the cleaned value and
    throws HttpError(400, message) when it is not acceptable.
*/
const { HttpError } = require('./http');
const validate = require('./validate');

function fail(message) {
    throw new HttpError(400, message, 'VALIDATION');
}

// Money with at most 2 decimals, 0 or more (DECIMAL(10,2) holds up to 99,999,999.99)
function money(value, label) {
    if (value === '' || value === null || value === undefined || typeof value === 'boolean') fail(`${label} is required.`);
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 99999999.99) fail(`${label} must be a number from 0 to 99,999,999.99.`);
    return Math.round(n * 100) / 100;
}

// A number from 0 to max with at most `places` decimals
function decimal(value, label, { max, places = 2 } = {}) {
    if (value === '' || value === null || value === undefined || typeof value === 'boolean') fail(`${label} is required.`);
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > max) fail(`${label} must be a number from 0 to ${max}.`);
    const f = 10 ** places;
    return Math.round(n * f) / f;
}

// Optional text: '' or missing becomes null
function optionalText(value, label, { max = 500 } = {}) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') fail(`${label} must be text.`);
    const v = value.trim();
    if (v === '') return null;
    if (v.length > max) fail(`${label} must be at most ${max} characters.`);
    return v;
}

// 'YYYY-MM-DD' that is a real calendar day
function isoDate(value, label) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) fail(`${label} must be a date (YYYY-MM-DD).`);
    const v = value.trim();
    const d = new Date(v + 'T00:00:00Z');
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) fail(`${label} is not a real date.`);
    return v;
}

function optionalDate(value, label) {
    if (value === undefined || value === null || value === '') return null;
    return isoDate(value, label);
}

// Two-letter state code, stored upper case (CHAR(2))
function stateCode(value, label = 'State') {
    if (typeof value !== 'string' || !/^[A-Za-z]{2}$/.test(value.trim())) fail(`${label} must be a 2-letter code such as TX.`);
    return value.trim().toUpperCase();
}

function oneOf(value, label, list) {
    if (!list.includes(value)) fail(`${label} must be one of: ${list.join(', ')}.`);
    return value;
}

function bool(value, label) {
    if (typeof value !== 'boolean') fail(`${label} must be true or false.`);
    return value;
}

// Search text -> LIKE pattern. [, % and _ are escaped so they match themselves. Empty -> null.
function likePattern(value) {
    if (typeof value !== 'string') return null;
    const v = value.trim().slice(0, 100);
    if (v === '') return null;
    return '%' + v.replace(/[\[%_]/g, '[$&]') + '%';
}

// A 7-digit id typed in a search box -> the number, otherwise null
function idFromSearch(value) {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    return /^\d{7}$/.test(v) ? Number(v) : null;
}

module.exports = { money, decimal, optionalText, isoDate, optionalDate, stateCode, oneOf, bool, likePattern, idFromSearch, integer: validate.integer };
