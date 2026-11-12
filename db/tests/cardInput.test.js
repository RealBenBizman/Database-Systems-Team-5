// src/shared/cardInput.js: card number, expiry and security code helpers for the checkout form.
const { loadEsm } = require('./helpers_esm');
const c = loadEsm('src/shared/cardInput.js');

const NOW = new Date(2026, 10, 11);   // 11 Nov 2026

describe('brand and number format', () => {
  test('detectBrand', () => {
    expect(c.detectBrand('4242424242424242')).toBe('visa');
    expect(c.detectBrand('5555555555554444')).toBe('mastercard');
    expect(c.detectBrand('2223003122003222')).toBe('mastercard');
    expect(c.detectBrand('378282246310005')).toBe('amex');
    expect(c.detectBrand('6011111111111117')).toBe('discover');
    expect(c.detectBrand('9999')).toBeNull();
    expect(c.detectBrand('')).toBeNull();
  });
  test('formatCardNumber groups digits as on a real card', () => {
    expect(c.formatCardNumber('4242424242424242')).toBe('4242 4242 4242 4242');
    expect(c.formatCardNumber('4242 4242 42')).toBe('4242 4242 42');
    expect(c.formatCardNumber('4242')).toBe('4242');
    expect(c.formatCardNumber('4242a4242-4242 4242 9999')).toBe('4242 4242 4242 4242');   // letters out, 16 digits at most
    expect(c.formatCardNumber('378282246310005')).toBe('3782 822463 10005');
    expect(c.formatCardNumber('')).toBe('');
  });
  test('cardLength and cvvLength', () => {
    expect(c.cardLength('amex')).toBe(15);
    expect(c.cardLength('visa')).toBe(16);
    expect(c.cardLength(null)).toBe(16);
    expect(c.cvvLength('amex')).toBe(4);
    expect(c.cvvLength('visa')).toBe(3);
  });
  test('luhnValid', () => {
    expect(c.luhnValid('4242424242424242')).toBe(true);
    expect(c.luhnValid('4242 4242 4242 4241')).toBe(false);
    expect(c.luhnValid('378282246310005')).toBe(true);
    expect(c.luhnValid('1234567890123456')).toBe(false);
    expect(c.luhnValid('4242')).toBe(false);
  });
});

describe('expiry date', () => {
  test('formatExpiry adds the slash while typing and lets Backspace work', () => {
    expect(c.formatExpiry('1', '')).toBe('1');
    expect(c.formatExpiry('12', '1')).toBe('12/');
    expect(c.formatExpiry('12/', '12')).toBe('12/');
    expect(c.formatExpiry('12/3', '12/')).toBe('12/3');
    expect(c.formatExpiry('12/34', '12/3')).toBe('12/34');
    expect(c.formatExpiry('12', '12/')).toBe('12');          // Backspace over the slash
    expect(c.formatExpiry('1234', '')).toBe('12/34');        // pasted
    expect(c.formatExpiry('12/345', '12/34')).toBe('12/34'); // no more than 4 digits
  });
  test('a month that cannot exist is fixed while typing', () => {
    expect(c.formatExpiry('4', '')).toBe('04/');
    expect(c.formatExpiry('13', '1')).toBe('1');
  });
  test('expiryProblem', () => {
    expect(c.expiryProblem('12/27', NOW)).toBe('');
    expect(c.expiryProblem('11/26', NOW)).toBe('');              // good through the end of its month
    expect(c.expiryProblem('10/26', NOW)).toBe('This card has expired.');
    expect(c.expiryProblem('01/20', NOW)).toBe('This card has expired.');
    expect(c.expiryProblem('00/28', NOW)).toMatch(/month/);
    expect(c.expiryProblem('13/28', NOW)).toMatch(/month/);
    expect(c.expiryProblem('1/28', NOW)).toMatch(/MM\/YY/);
    expect(c.expiryProblem('', NOW)).toMatch(/MM\/YY/);
    expect(c.expiryProblem('12/60', NOW)).toMatch(/year/);
  });
});

describe('validateCard', () => {
  const good = { name: 'Alice Nguyen', number: '4242 4242 4242 4242', expiry: '12/28', cvv: '123' };
  test('a good card has no errors', () => {
    expect(c.validateCard(good, NOW)).toEqual({});
  });
  test('each wrong field gets its own message', () => {
    const errors = c.validateCard({ name: ' ', number: '4242 4242 4242 4241', expiry: '10/26', cvv: '12' }, NOW);
    expect(Object.keys(errors).sort()).toEqual(['cvv', 'expiry', 'name', 'number']);
  });
  test('card number length and empty field', () => {
    expect(c.validateCard({ ...good, number: '' }, NOW).number).toMatch(/Enter the card number/);
    expect(c.validateCard({ ...good, number: '4242 4242' }, NOW).number).toMatch(/16 digits/);
  });
  test('American Express has 15 digits and a 4 digit code', () => {
    const amex = { name: 'A B', number: '3782 822463 10005', expiry: '12/28', cvv: '1234' };
    expect(c.validateCard(amex, NOW)).toEqual({});
    expect(c.validateCard({ ...amex, cvv: '123' }, NOW).cvv).toMatch(/4 digits/);
  });
  test('the code must be digits only', () => {
    expect(c.validateCard({ ...good, cvv: '12a' }, NOW).cvv).toBeDefined();
    expect(c.validateCard({ ...good, cvv: '1234' }, NOW).cvv).toBeDefined();
  });
});

describe('what the app keeps', () => {
  test('cardLast4 returns only the last 4 digits', () => {
    expect(c.cardLast4('4242 4242 4242 4242')).toBe('4242');
    expect(c.cardLast4('3782 822463 10005')).toBe('0005');
    expect(c.cardLast4('')).toBe('');
  });
});
