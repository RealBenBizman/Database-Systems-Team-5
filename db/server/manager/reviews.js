// Review moderation (managers only): find reviews and remove the ones that do not belong in the shop.
// GET    /api/manager/reviews?q=text&productId=123 -> up to 100 newest visible reviews (product, author, rating, comment)
// DELETE /api/manager/reviews?id=123               -> remove (flagged, not deleted); it disappears from the product page and the rating
const { route } = require('../../lib/http');
const { query, withTransaction } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const validate = require('../../lib/validate');
const f = require('../../lib/fields');
const { softDelete } = require('../../lib/softDelete');

const LIST_SQL = `
  SELECT TOP (100)
         rv.Review_id AS reviewId, rv.Rating AS rating, rv.Comment AS comment,
         CONVERT(VARCHAR(10), rv.Review_date, 23) AS reviewDate,
         p.Product_id AS productId, p.Name AS product,
         c.Customer_id AS customerId, CONCAT(c.First_name, N' ', c.Last_name) AS author, c.Email AS email
  FROM   REVIEW rv
  JOIN   PRODUCT p  ON p.Product_id  = rv.Product_id  AND p.Marked_for_deletion = 0
  JOIN   CUSTOMER c ON c.Customer_id = rv.Customer_id AND c.Marked_for_deletion = 0
  WHERE  rv.Marked_for_deletion = 0
    AND  (@productId IS NULL OR rv.Product_id = @productId)
    AND  (@like IS NULL OR p.Name LIKE @like OR p.SKU LIKE @like OR rv.Comment LIKE @like
          OR c.Email LIKE @like OR CONCAT(c.First_name, N' ', c.Last_name) LIKE @like)
  ORDER BY rv.Review_date DESC, rv.Review_id DESC`;

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['manager']);
    const q = req.query || {};
    const productId = q.productId === undefined || q.productId === '' ? null : validate.integer(q.productId, 'Product');
    const result = await query(LIST_SQL, { like: f.likePattern(q.q), productId });
    return { reviews: result.recordset };
  },

  DELETE: async (req) => {
    requireAuth(req, ['manager']);
    const reviewId = validate.integer(req.query && req.query.id, 'Review');
    await withTransaction((tx) => softDelete(tx, 'REVIEW', 'Review_id', reviewId, 'Review'));
    return { ok: true };
  },
});
