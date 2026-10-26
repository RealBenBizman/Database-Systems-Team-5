const db = require('../../lib/db');
const { route, readBody, HttpError } = require('../../lib/http');
const validate = require('../../lib/validate');
const { customer, keys, boolean, ADDRESS_COLUMNS } = require('../../lib/storefront');

module.exports = route({
  GET: async (req) => {
    const user = await customer(req);
    const result = await db.query(`SELECT c.Customer_id AS id, c.First_name AS firstName, c.Last_name AS lastName,
      c.Email AS email, c.Notify_cart AS notifyCart, c.Notify_offers AS notifyOffers, c.Created_date AS createdDate,
      c.Loyalty_points AS points, t.Tier_name AS tier FROM CUSTOMER c
      LEFT JOIN REWARD_TIER t ON t.Tier_id = c.Tier_id AND t.Marked_for_deletion = 0
      WHERE c.Customer_id = @customerId AND c.Marked_for_deletion = 0;
      SELECT ${ADDRESS_COLUMNS} FROM CUSTOMER_ADDRESS WHERE Customer_id = @customerId AND Marked_for_deletion = 0
        ORDER BY is_default DESC, Address_id;
      SELECT Phone_number AS phone FROM CUSTOMER_PHONE WHERE Customer_id = @customerId AND Marked_for_deletion = 0 ORDER BY Phone_number`, { customerId: user.id });
    return { profile: result.recordsets[0][0], addresses: result.recordsets[1], phones: result.recordsets[2] };
  },
  PATCH: async (req) => {
    const user = await customer(req);
    const body = readBody(req); keys(body, ['firstName', 'lastName', 'email', 'notifyCart', 'notifyOffers']);
    const updates = [];
    const params = { customerId: user.id };
    for (const [key, column] of Object.entries({ firstName: 'First_name', lastName: 'Last_name', email: 'Email', notifyCart: 'Notify_cart', notifyOffers: 'Notify_offers' })) {
      if (!Object.hasOwn(body, key)) continue;
      params[key] = key === 'email' ? validate.email(body[key]) : key.startsWith('notify') ? boolean(body[key], 'Preference') : validate.text(body[key], key === 'firstName' ? 'First name' : 'Last name', { max: 50 });
      updates.push(`${column} = @${key}`);
    }
    if (!updates.length) throw new HttpError(400, 'Choose a field to update.');
    await db.query(`UPDATE CUSTOMER SET ${updates.join(', ')} WHERE Customer_id = @customerId AND Marked_for_deletion = 0`, params);
    return { ok: true };
  },
});
