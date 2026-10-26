const crypto = require('node:crypto');
const db = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const { route, HttpError } = require('../../lib/http');

async function run(req) {
  const secret = process.env.CRON_SECRET;
  const authorization = req.headers && req.headers.authorization;
  const expected = secret ? Buffer.from(`Bearer ${secret}`) : null;
  const supplied = Buffer.from(typeof authorization === 'string' ? authorization : '');
  const cron = expected && expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
  if (!cron) {
    if (req.method === 'GET') throw new HttpError(401, 'A valid job credential is required.');
    const user = requireAuth(req, ['manager']);
    const employee = await db.query("SELECT Employee_id FROM EMPLOYEE WHERE Employee_id = @id AND Role = 'Manager' AND Marked_for_deletion = 0", { id: user.id });
    if (!employee.recordset.length) throw new HttpError(403, 'Manager access is required.');
  }
  return db.withTransaction(async (tx) => {
    const lock = await tx.query(`DECLARE @result INT;
      EXEC @result = sys.sp_getapplock @Resource = N'pos-store-notifications', @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 0;
      SELECT @result AS result;`);
    if (lock.recordset[0].result < 0) throw new HttpError(409, 'The notification job is already running.');
    const reminders = await tx.query(`INSERT INTO NOTIFICATION (Customer_id, Notification_type, Message, Sent_at)
      OUTPUT inserted.Notification_id AS id
      SELECT c.Customer_id, 'cart reminder', 'You left items in your cart. Take another look before they sell out.', SYSDATETIME()
      FROM CUSTOMER c
      CROSS APPLY (SELECT MAX(ci.Added_at) AS LastActivity FROM CART_ITEM ci
        WHERE ci.Customer_id = c.Customer_id AND ci.Marked_for_deletion = 0) cart
      WHERE c.Marked_for_deletion = 0 AND c.Notify_cart = 1 AND cart.LastActivity < DATEADD(HOUR, -24, SYSDATETIME())
        AND EXISTS (SELECT 1 FROM CART_ITEM ci JOIN PRODUCT p ON p.Product_id = ci.Product_id
          WHERE ci.Customer_id = c.Customer_id AND ci.Marked_for_deletion = 0 AND p.Marked_for_deletion = 0 AND p.Is_active = 1)
        AND NOT EXISTS (SELECT 1 FROM NOTIFICATION n WITH (UPDLOCK, HOLDLOCK) WHERE n.Customer_id = c.Customer_id
          AND n.Notification_type = 'cart reminder' AND n.Created_at >= DATEADD(DAY, -3, SYSDATETIME()))`);
    const offers = await tx.query(`INSERT INTO NOTIFICATION (Customer_id, Notification_type, Message, Discount_id, Sent_at)
      OUTPUT inserted.Notification_id AS id
      SELECT c.Customer_id, 'offer', CONCAT('Offer available: ', d.Discount_name, '. Browse the shop for eligible products.'), d.Discount_id, SYSDATETIME()
      FROM CUSTOMER c CROSS JOIN DISCOUNT d
      WHERE c.Marked_for_deletion = 0 AND c.Notify_offers = 1 AND d.Marked_for_deletion = 0 AND d.Is_active = 1
        AND CAST(SYSDATETIME() AS DATE) BETWEEN d.Start_date AND d.End_date
        AND EXISTS (SELECT 1 FROM PRODUCT p JOIN CATEGORY cat ON cat.Category_id = p.Category_id
          WHERE p.Marked_for_deletion = 0 AND p.Is_active = 1 AND cat.Marked_for_deletion = 0
            AND (p.Discount_id = d.Discount_id OR cat.Discount_id = d.Discount_id))
        AND NOT EXISTS (SELECT 1 FROM NOTIFICATION n WITH (UPDLOCK, HOLDLOCK)
          WHERE n.Customer_id = c.Customer_id AND n.Notification_type = 'offer' AND n.Discount_id = d.Discount_id)`);
    return { cartReminders: reminders.recordset.length, offers: offers.recordset.length };
  });
}

module.exports = route({ GET: run, POST: run });
