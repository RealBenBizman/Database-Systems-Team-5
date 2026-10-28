// GET /api/manager/customers/<id> -> one customer: profile, addresses, phones, points history and orders
// Managers only, read only. Never returns the password hash.
const { route, HttpError } = require('../../../lib/http');
const { query } = require('../../../lib/db');
const { requireAuth } = require('../../../lib/auth');
const validate = require('../../../lib/validate');

const PROFILE_SQL = `
  SELECT c.Customer_id AS customerId, c.First_name AS firstName, c.Last_name AS lastName,
         c.Email AS email, c.Loyalty_points AS points, t.Tier_name AS tier,
         CONVERT(VARCHAR(10), c.Created_date, 23) AS createdDate,
         c.Notify_offers AS notifyOffers, c.Notify_cart AS notifyCart
  FROM   CUSTOMER c
  LEFT JOIN REWARD_TIER t ON t.Tier_id = c.Tier_id AND t.Marked_for_deletion = 0
  WHERE  c.Customer_id = @id AND c.Marked_for_deletion = 0`;

const ADDRESSES_SQL = `
  SELECT Address_id AS addressId, Address_type AS type, Recipient_name AS recipient, Street AS street,
         Apt AS apt, City AS city, State AS state, Zip AS zip, is_default AS isDefault
  FROM   CUSTOMER_ADDRESS
  WHERE  Customer_id = @id AND Marked_for_deletion = 0
  ORDER BY is_default DESC, Address_id`;

const PHONES_SQL = `
  SELECT Phone_number AS phone FROM CUSTOMER_PHONE
  WHERE  Customer_id = @id AND Marked_for_deletion = 0
  ORDER BY Phone_number`;

const POINTS_SQL = `
  SELECT TOP (50) Loyalty_txn_id AS txnId, Points_change AS pointsChange, Reason AS reason, Transaction_id AS orderId,
         CONVERT(VARCHAR(16), Created_at, 120) AS createdAt
  FROM   LOYALTY_TRANSACTION
  WHERE  Customer_id = @id AND Marked_for_deletion = 0
  ORDER BY Created_at DESC, Loyalty_txn_id DESC`;

const ORDERS_SQL = `
  SELECT TOP (100) Transaction_id AS orderId, Status AS status, Total AS total,
         Tracking_number AS trackingNumber,
         CONVERT(VARCHAR(16), Transaction_date, 120) AS orderDate
  FROM   SALES_TRANSACTION
  WHERE  Customer_id = @id AND Marked_for_deletion = 0
  ORDER BY Transaction_date DESC, Transaction_id DESC`;

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['manager']);
    const id = validate.integer(req.query && req.query.id, 'Customer', { min: 1000000, max: 9999999 });

    const profile = await query(PROFILE_SQL, { id });
    if (profile.recordset.length === 0) throw new HttpError(404, 'Customer not found.');

    const [addresses, phones, points, orders] = await Promise.all([
      query(ADDRESSES_SQL, { id }),
      query(PHONES_SQL, { id }),
      query(POINTS_SQL, { id }),
      query(ORDERS_SQL, { id }),
    ]);
    return {
      customer: profile.recordset[0],
      addresses: addresses.recordset,
      phones: phones.recordset.map((p) => p.phone),
      pointsHistory: points.recordset,
      orders: orders.recordset,
    };
  },
});
