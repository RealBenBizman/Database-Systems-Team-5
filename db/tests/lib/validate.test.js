const v = require('../../lib/validate');

const rejects = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a 400'); };

test('text trims, enforces length, requires a string', () => {
  expect(v.text('  Ana ', 'Name', { max: 5 })).toBe('Ana');
  expect(rejects(() => v.text('', 'Name')).status).toBe(400);
  expect(rejects(() => v.text('   ', 'Name')).message).toBe('Name is required.');
  expect(rejects(() => v.text(undefined, 'Name')).status).toBe(400);
  expect(rejects(() => v.text(42, 'Name')).status).toBe(400);
  expect(rejects(() => v.text('abcdef', 'Name', { max: 5 })).message).toMatch(/at most 5/);
});

test('email lower-cases and checks the shape', () => {
  expect(v.email('  Alice.Nguyen@PosStore.test ')).toBe('alice.nguyen@posstore.test');
  for (const bad of ['', 'nope', 'a@b', 'a b@c.com', '@c.com', null, ['a@b.com']]) {
    expect(rejects(() => v.email(bad)).status).toBe(400);
  }
  expect(rejects(() => v.email('a'.repeat(95) + '@b.com')).status).toBe(400); // over 100 chars
});

test('newPassword rules', () => {
  expect(v.newPassword('Password123!')).toBe('Password123!');
  expect(rejects(() => v.newPassword('short1')).message).toMatch(/at least 8/);
  expect(rejects(() => v.newPassword('onlyletters')).message).toMatch(/letter and a number/);
  expect(rejects(() => v.newPassword('12345678')).message).toMatch(/letter and a number/);
  expect(rejects(() => v.newPassword('a1'.repeat(37))).message).toMatch(/too long/); // 74 bytes
  expect(rejects(() => v.newPassword(undefined)).status).toBe(400);
});

test('passwordInput only needs something sensible', () => {
  expect(v.passwordInput('x')).toBe('x');
  expect(rejects(() => v.passwordInput('')).status).toBe(400);
  expect(rejects(() => v.passwordInput('a'.repeat(73))).status).toBe(400);
});

test('integer accepts numeric strings and rejects the rest', () => {
  expect(v.integer('5', 'Qty')).toBe(5);
  expect(v.integer(7, 'Qty', { min: 1, max: 10 })).toBe(7);
  for (const bad of [0, 1.5, 'abc', '', null, 11]) {
    expect(rejects(() => v.integer(bad, 'Qty', { min: 1, max: 10 })).status).toBe(400);
  }
});