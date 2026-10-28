const db = require('../../lib/db');
const { route, readBody, HttpError } = require('../../lib/http');
const validate = require('../../lib/validate');
const { id, customer, keys } = require('../../lib/storefront');

module.exports = route({
  GET: async (req) => {
    const q = req.query || {};
    const productId = id(q.productId, 'Product');
    const page = q.page === undefined ? 1 : validate.integer(q.page, 'Page', { max: 100000 });
    const result = await db.query(`SELECT rv.Review_id AS id, rv.Rating AS rating, rv.Comment AS comment,
      rv.Review_date AS date, CONCAT(c.First_name, N' ', LEFT(c.Last_name, 1), N'.') AS author,
      CAST(CASE WHEN EXISTS (SELECT 1 FROM SALES_TRANSACTION s JOIN TRANSACTION_ITEM ti ON ti.Transaction_id = s.Transaction_id
        WHERE s.Transaction_id = rv.Transaction_id AND s.Customer_id = rv.Customer_id AND s.Status = 'completed'
          AND ti.Product_id = rv.Product_id AND s.Marked_for_deletion = 0 AND ti.Marked_for_deletion = 0) THEN 1 ELSE 0 END AS BIT) AS verified,
      COUNT(*) OVER () AS total
      FROM REVIEW rv JOIN CUSTOMER c ON c.Customer_id = rv.Customer_id
      JOIN PRODUCT p ON p.Product_id = rv.Product_id JOIN CATEGORY cat ON cat.Category_id = p.Category_id
      WHERE rv.Product_id = @productId AND rv.Marked_for_deletion = 0 AND c.Marked_for_deletion = 0
        AND p.Marked_for_deletion = 0 AND p.Is_active = 1 AND cat.Marked_for_deletion = 0
      ORDER BY rv.Review_date DESC, rv.Review_id DESC OFFSET @offset ROWS FETCH NEXT 10 ROWS ONLY`, { productId, offset: (page - 1) * 10 });
    return { reviews: result.recordset.map(({ total, ...review }) => review), total: result.recordset[0]?.total || 0, page };
  },
  POST: async (req) => {
    const user = await customer(req);
    const body = readBody(req); keys(body, ['productId', 'rating', 'comment', 'transactionId']);
    const productId = id(body.productId, 'Product');
    const rating = validate.integer(body.rating, 'Rating', { min: 1, max: 5 });
    const comment = body.comment ? validate.text(body.comment, 'Review', { max: 1000 }) : null;
    const transactionId = body.transactionId === null || body.transactionId === undefined || body.transactionId === '' ? null : id(body.transactionId, 'Purchase');
    const reviewId = await db.withTransaction(async (tx) => {
      const product = await tx.query(`SELECT p.Product_id FROM PRODUCT p JOIN CATEGORY c ON c.Category_id = p.Category_id
        WHERE p.Product_id = @productId AND p.Is_active = 1 AND p.Marked_for_deletion = 0 AND c.Marked_for_deletion = 0`, { productId });
      if (!product.recordset.length) throw new HttpError(404, 'This product is no longer available.');
      if (transactionId !== null) {
        const purchase = await tx.query(`SELECT s.Transaction_id FROM SALES_TRANSACTION s
          JOIN TRANSACTION_ITEM ti ON ti.Transaction_id = s.Transaction_id
          WHERE s.Transaction_id = @transactionId AND s.Customer_id = @customerId AND s.Status = 'completed'
            AND ti.Product_id = @productId AND s.Marked_for_deletion = 0 AND ti.Marked_for_deletion = 0`, { transactionId, customerId: user.id, productId });
        if (!purchase.recordset.length) throw new HttpError(409, 'Choose one of your completed purchases containing this product.');
      }
      const result = await tx.query(`DECLARE @created TABLE (id INT);
        INSERT INTO REVIEW (Product_id, Customer_id, Rating, Comment, Transaction_id)
        OUTPUT inserted.Review_id INTO @created VALUES (@productId, @customerId, @rating, @comment, @transactionId);
        SELECT id FROM @created;`, {
        productId, customerId: user.id, rating, comment: { type: db.sql.NVarChar(1000), value: comment },
        transactionId: { type: db.sql.Int, value: transactionId },
      });
      return result.recordset[0].id;
    });
    return { status: 201, body: { id: reviewId } };
  },
});
