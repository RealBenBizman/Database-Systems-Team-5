const db = require('../../lib/db');
const { route, readBody, HttpError } = require('../../lib/http');
const { customer, phone, keys, lockCustomer } = require('../../lib/storefront');

module.exports = route({
  GET: async (req) => {
    const user = await customer(req);
    const result = await db.query('SELECT Phone_number AS phone FROM CUSTOMER_PHONE WHERE Customer_id = @customerId AND Marked_for_deletion = 0 ORDER BY Phone_number', { customerId: user.id });
    return { phones: result.recordset };
  },
  POST: async (req) => {
    const user = await customer(req);
    const body = readBody(req); keys(body, ['phone']);
    const number = phone(body.phone);
    await db.withTransaction(async (tx) => {
      await lockCustomer(tx, user.id);
      const params = { customerId: user.id, phone: number };
      const found = await tx.query('SELECT Marked_for_deletion AS deleted FROM CUSTOMER_PHONE WHERE Customer_id = @customerId AND Phone_number = @phone', params);
      if (found.recordset.length && !found.recordset[0].deleted) throw new HttpError(409, 'This phone number is already saved.');
      if (found.recordset.length) await tx.query('UPDATE CUSTOMER_PHONE SET Marked_for_deletion = 0 WHERE Customer_id = @customerId AND Phone_number = @phone', params);
      else await tx.query('INSERT INTO CUSTOMER_PHONE (Customer_id, Phone_number) VALUES (@customerId, @phone)', params);
    });
    return { status: 201, body: { phone: number } };
  },
  DELETE: async (req) => {
    const user = await customer(req);
    const number = phone(req.query && req.query.phone);
    const result = await db.query(`UPDATE CUSTOMER_PHONE SET Marked_for_deletion = 1 OUTPUT inserted.Phone_number AS phone
      WHERE Customer_id = @customerId AND Phone_number = @phone AND Marked_for_deletion = 0`, { customerId: user.id, phone: number });
    if (!result.recordset.length) throw new HttpError(404, 'Phone number not found.');
    return { ok: true };
  },
});
