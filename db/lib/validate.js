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

function email(value, label = 'Email'){
    const v = text(value, label, { max: 100}).toLowerCase();
    if (!EMAIL_RE.test(v)) fail('Enter a valid email address.');
    return v;
}

function newPassword(value, label = 'Password'){
    if (typeof value !== 'string') fail(`${label} is required.`);
    if (value.length < 8) fail(`${label} must be at least 8 characters.`);
    if (Buffer.byteLength(value, 'utf8') > 72) fail(`${label} is too long (72 bytes at most).`);
    if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) fail(`${label} must contain a letter and a number.`);
    return value;
}

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