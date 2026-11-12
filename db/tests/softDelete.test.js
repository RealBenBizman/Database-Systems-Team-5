// lib/softDelete.js: flags the row, 404 when nothing changed, refuses names that are not on its list.
const { softDelete, REMOVABLE } = require('../lib/softDelete');
const { HttpError } = require('../lib/http');

const txReturning = (affected) => ({ query: jest.fn().mockResolvedValue({ recordset: [], rowsAffected: [affected] }) });

test('flags the row with a parameter and returns ok', async () => {
  const tx = txReturning(1);
  await expect(softDelete(tx, 'PRODUCT', 'Product_id', 1000007, 'Product')).resolves.toEqual({ ok: true });
  const [sql, params] = tx.query.mock.calls[0];
  expect(sql).toBe('UPDATE PRODUCT SET Marked_for_deletion = 1 WHERE Product_id = @id AND Marked_for_deletion = 0');
  expect(params).toEqual({ id: 1000007 });
});

test('never uses DELETE and never puts the id in the SQL text', async () => {
  const tx = txReturning(1);
  await softDelete(tx, 'SUPPLIER', 'Supplier_id', '1; DROP TABLE PRODUCT', 'Supplier');
  const sql = tx.query.mock.calls[0][0];
  expect(sql).not.toMatch(/DELETE\s+FROM/i);
  expect(sql).not.toMatch(/DROP/i);
});

test('nothing changed (unknown id or already removed) is a 404 with the label', async () => {
  const tx = txReturning(0);
  const err = await softDelete(tx, 'DISCOUNT', 'Discount_id', 5, 'Discount').catch((e) => e);
  expect(err).toBeInstanceOf(HttpError);
  expect(err.status).toBe(404);
  expect(err.message).toBe('Discount not found.');
});

test('the 404 says Item when no label is given', async () => {
  const err = await softDelete(txReturning(0), 'REVIEW', 'Review_id', 5).catch((e) => e);
  expect(err.message).toBe('Item not found.');
});

test.each([
  ['a table that is not on the list', 'SALES_TRANSACTION', 'Transaction_id'],
  ['a column that does not belong to that table', 'PRODUCT', 'Name; --'],
  ['a name taken from the prototype chain', 'constructor', 'name'],
  ['injection in the table name', 'PRODUCT SET x=1; --', 'Product_id'],
])('refuses %s without touching the database', async (name, table, column) => {
  const tx = txReturning(1);
  await expect(softDelete(tx, table, column, 1)).rejects.toThrow(/not on the list/);
  expect(tx.query).not.toHaveBeenCalled();
});

test('every table on the list is flagged by name and key, nothing else', () => {
  for (const [table, column] of Object.entries(REMOVABLE)) {
    expect(table).toMatch(/^[A-Z_]+$/);
    expect(column).toMatch(/^[A-Za-z_]+$/);
  }
  expect(REMOVABLE).not.toHaveProperty('SALES_TRANSACTION');
  expect(REMOVABLE).not.toHaveProperty('PAYMENT');
});