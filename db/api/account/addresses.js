const db = require('../../lib/db');
const { route, readBody, HttpError } = require('../../lib/http');
const { customer, id, address, lockCustomer, ADDRESS_COLUMNS } = require('../../lib/storefront');

async function save(req, editing) {
  const user = await customer(req);
  const body = readBody(req);
  const fields = address(body);
  const addressId = editing ? id(body.id, 'Address') : null;
  if (!editing && body.id !== undefined) throw new HttpError(400, 'A new address must not have an ID.');
  return db.withTransaction(async (tx) => {
    await lockCustomer(tx, user.id);
    const params = { ...fields, customerId: user.id, addressId };
    if (editing) {
      const found = await tx.query('SELECT Address_id FROM CUSTOMER_ADDRESS WHERE Address_id = @addressId AND Customer_id = @customerId AND Marked_for_deletion = 0', params);
      if (!found.recordset.length) throw new HttpError(404, 'Address not found.');
    }
    if (fields.isDefault) await tx.query('UPDATE CUSTOMER_ADDRESS SET is_default = 0 WHERE Customer_id = @customerId AND is_default = 1', { customerId: user.id });
    const result = await tx.query(editing
      ? `UPDATE CUSTOMER_ADDRESS SET Address_type = @type, Recipient_name = @recipient, Street = @street,
          Apt = @apt, City = @city, State = @state, Zip = @zip, is_default = @isDefault
          OUTPUT inserted.Address_id AS id WHERE Address_id = @addressId AND Customer_id = @customerId AND Marked_for_deletion = 0`
      : `INSERT INTO CUSTOMER_ADDRESS (Customer_id, Address_type, Recipient_name, Street, Apt, City, State, Zip, is_default)
          OUTPUT inserted.Address_id AS id VALUES (@customerId, @type, @recipient, @street, @apt, @city, @state, @zip, @isDefault)`,
    { ...params, apt: { type: db.sql.VarChar(10), value: fields.apt } });
    return { id: result.recordset[0].id };
  });
}

module.exports = route({
  GET: async (req) => {
    const user = await customer(req);
    const result = await db.query(`SELECT ${ADDRESS_COLUMNS} FROM CUSTOMER_ADDRESS
      WHERE Customer_id = @customerId AND Marked_for_deletion = 0 ORDER BY is_default DESC, Address_id`, { customerId: user.id });
    return { addresses: result.recordset };
  },
  POST: async (req) => ({ status: 201, body: await save(req, false) }),
  PATCH: async (req) => save(req, true),
  DELETE: async (req) => {
    const user = await customer(req);
    const addressId = id(req.query && req.query.id, 'Address');
    await db.withTransaction(async (tx) => {
      await lockCustomer(tx, user.id);
      const result = await tx.query(`UPDATE CUSTOMER_ADDRESS SET Marked_for_deletion = 1, is_default = 0
        OUTPUT inserted.Address_id AS id WHERE Address_id = @addressId AND Customer_id = @customerId AND Marked_for_deletion = 0`, { customerId: user.id, addressId });
      if (!result.recordset.length) throw new HttpError(404, 'Address not found.');
    });
    return { ok: true };
  },
});
