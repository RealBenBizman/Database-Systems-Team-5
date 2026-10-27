/*
    lib/validate.js - check what the browser sends

    Eache heper reads one field from the body, returns the cleaned value and throws
    HttpError(400, message) when it is not acceptable. The same rules should be repeated
    on the form (for quick feedback), but this is the check that counts.

    const email = validate.email(body.email);
    const first = validate.text(body.firstName, 'First name', { max: 50 });
*/
const { HttpError } = require('./http');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(message) {
    throw new HttpError(400, message, 'VALIDATION');
}

function text(value, label, { min = 1, max = 100} = {}) {
    if (typeof value !== 'string') fail(`${label} is required.`);
    const v = value.trim();
    if (v.length < min) fail(min === 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`);
    if (v.length > max) fail(`${label} must be at most ${max} characters.`);
    return v;
}

//Emails are stored lower case; the column is VARCHAR(100)
function email(value, label = 'Email'){
    const v = text(value, label, { max: 100}).toLowerCase();
    if (!EMAIL_RE.test(v)) fail('Enter a valid email address.');
    return v;
}

//bscrypt only reads the first 72 bytes, so longer passwords are refused instead of silent cut
function newPassword(value, label = 'Password'){
    if (typeof value !== 'string') fail(`${label} is required.`);
    if (value.length < 8) fail(`${label} must be at least 8 characters.`);
    if (Buffer.byteLength(value, 'utf8') > 72) fail(`${label} is too long (72 bytes at most).`);
    if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) fail(`${label} must contain a letter and a number.`);
    return value;
}

//For login: jus make sure something reasonable was sent
function passwordInput(value, label = 'Password') {
    if (typeof value !== 'string' || value.length === 0) fail(`${label} is required.`);
    if(Buffer.byteLength(value, 'utf8') > 72) fail('Incorrect email or password.');
    return value;
}

function integer(value, label, { min = 1, max = 2147483647 } = {}) {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (!Number.isInteger(n) || n < min || n > max) fail(`${label} must be a whole number between ${min} and ${max}`);
    return n;
}

module.exports = { text, email, newPassword, passwordInput, integer };