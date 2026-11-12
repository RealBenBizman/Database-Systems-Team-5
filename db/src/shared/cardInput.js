// Helpers for the card form on the checkout page (no React in here, so they are easy to test:
// tests/cardInput.test.js). The full card number, the expiry date and the security code are only
// checked in the browser and are NEVER sent to the server or stored: the checkout request carries only
// the card type and the last 4 digits (cardLast4(...)), which is all the PAYMENT table can hold.

export function digitsOnly(text) {
  return String(text ?? '').replace(/\D/g, '');
}

// 'visa' | 'mastercard' | 'amex' | 'discover' | null, from the first digits typed so far
export function detectBrand(digits) {
  const d = digitsOnly(digits);
  if (/^3[47]/.test(d)) return 'amex';
  if (/^4/.test(d)) return 'visa';
  if (/^5[1-5]/.test(d)) return 'mastercard';
  const two = Number(d.slice(0, 4));
  if (d.length >= 4 && two >= 2221 && two <= 2720) return 'mastercard';
  if (/^(6011|65|64[4-9])/.test(d)) return 'discover';
  return null;
}

export const BRAND_NAMES = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', discover: 'Discover' };

// the number of digits the card number must have
export function cardLength(brand) {
  return brand === 'amex' ? 15 : 16;
}

// '4242424242424242' -> '4242 4242 4242 4242'   (American Express: 3782 822463 10005)
export function formatCardNumber(text) {
  const brand = detectBrand(text);
  const d = digitsOnly(text).slice(0, cardLength(brand));
  if (brand === 'amex') {
    return [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)].filter(Boolean).join(' ');
  }
  return d.replace(/(\d{4})(?=\d)/g, '$1 ');
}

// Luhn check: catches a mistyped digit
export function luhnValid(digits) {
  const d = digitsOnly(digits);
  if (d.length < 12) return false;
  let sum = 0;
  let double = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (double) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

// What is typed in the expiry field -> 'MM/YY'. `previous` is the text before this change: the slash is
// added when a digit is typed after the month, and Backspace still works (deleting the slash is not undone).
export function formatExpiry(text, previous = '') {
  let d = digitsOnly(text).slice(0, 4);
  if (d.length >= 1 && d[0] > '1') d = `0${d}`;                  // 4 -> 04
  if (d.length >= 2 && Number(d.slice(0, 2)) > 12) d = d[0] + d.slice(2);  // 13 -> 1
  d = d.slice(0, 4);
  const growing = String(text ?? '').length > String(previous ?? '').length;
  if (d.length === 2 && growing) return `${d}/`;
  if (d.length > 2) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return d;
}

// '' when the expiry date is fine, otherwise the message to show. A card is good through the last day of its month.
export function expiryProblem(text, now = new Date()) {
  const m = /^(\d{2})\/(\d{2})$/.exec(String(text ?? '').trim());
  if (!m) return 'Enter the expiration date as MM/YY.';
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return 'The month must be between 01 and 12.';
  const nowMonth = now.getFullYear() * 12 + now.getMonth();
  const cardMonth = year * 12 + (month - 1);
  if (cardMonth < nowMonth) return 'This card has expired.';
  if (cardMonth > nowMonth + 12 * 20) return 'Check the expiration year.';
  return '';
}

// 3 digits, 4 for American Express
export function cvvLength(brand) {
  return brand === 'amex' ? 4 : 3;
}

/*
  Checks the whole form. Returns an object with one message per field that is wrong, and {} when all is fine.
    validateCard({ name, number, expiry, cvv }, now)
*/
export function validateCard({ name, number, expiry, cvv }, now = new Date()) {
  const errors = {};
  if (String(name ?? '').trim().length < 2) errors.name = 'Enter the name as shown on the card.';

  const digits = digitsOnly(number);
  const brand = detectBrand(digits);
  if (!digits) errors.number = 'Enter the card number.';
  else if (digits.length !== cardLength(brand)) errors.number = `The card number must have ${cardLength(brand)} digits.`;
  else if (!luhnValid(digits)) errors.number = 'This card number is not valid. Check the digits.';

  const expiryMessage = expiryProblem(expiry, now);
  if (expiryMessage) errors.expiry = expiryMessage;

  const code = digitsOnly(cvv);
  if (code.length !== cvvLength(brand) || code !== String(cvv ?? '').trim()) {
    errors.cvv = `The security code has ${cvvLength(brand)} digits.`;
  }
  return errors;
}

// the only part of the card number the app keeps
export function cardLast4(number) {
  return digitsOnly(number).slice(-4);
}
