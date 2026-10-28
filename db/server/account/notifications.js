const { query } = require('../../lib/db');
const { route, readBody, HttpError } = require('../../lib/http');
const validate = require('../../lib/validate');
const { id, customer, keys } = require('../../lib/storefront');

module.exports = route({
  GET: async (req) => {
    const user = await customer(req);
    const q = req.query || {};
    const page = q.page === undefined ? 1 : validate.integer(q.page, 'Page', { max: 100000 });
    const unread = q.unread === 'true' ? 'AND Read_at IS NULL' : '';
    const result = await query(`SELECT Notification_id AS id, Notification_type AS type, Message AS message,
      Discount_id AS discountId, Created_at AS createdAt, Read_at AS readAt
      FROM NOTIFICATION WHERE Customer_id = @customerId AND Marked_for_deletion = 0 ${unread}
      ORDER BY Created_at DESC, Notification_id DESC OFFSET @offset ROWS FETCH NEXT 20 ROWS ONLY;
      SELECT COUNT(*) AS total, ISNULL(SUM(CASE WHEN Read_at IS NULL THEN 1 ELSE 0 END), 0) AS unread
      FROM NOTIFICATION WHERE Customer_id = @customerId AND Marked_for_deletion = 0 ${unread}`, { customerId: user.id, offset: (page - 1) * 20 });
    return { notifications: result.recordsets[0], ...result.recordsets[1][0], page };
  },
  PATCH: async (req) => {
    const user = await customer(req);
    const body = readBody(req); keys(body, ['id', 'all']);
    if (body.all === true) {
      if (body.id !== undefined) throw new HttpError(400, 'Choose one notification or all notifications.');
      await query(`UPDATE NOTIFICATION SET Read_at = SYSDATETIME()
        WHERE Customer_id = @customerId AND Marked_for_deletion = 0 AND Read_at IS NULL`, { customerId: user.id });
    } else {
      const result = await query(`UPDATE NOTIFICATION SET Read_at = ISNULL(Read_at, SYSDATETIME()) OUTPUT inserted.Notification_id AS id
        WHERE Notification_id = @id AND Customer_id = @customerId AND Marked_for_deletion = 0`, { id: id(body.id, 'Notification'), customerId: user.id });
      if (!result.recordset.length) throw new HttpError(404, 'Notification not found.');
    }
    return { ok: true };
  },
});
