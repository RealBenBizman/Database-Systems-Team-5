const { query, sql } = require('../../lib/db');
const { route, HttpError } = require('../../lib/http');
const validate = require('../../lib/validate');
const { id, productSelect, PRODUCT_JOINS, PUBLIC_PRODUCT } = require('../../lib/storefront');

// Same list as GET /api/products/categories. The shop page asks for it together with the
// products (withCategories=true) so it needs one request fewer. Keep the two in step.
const CATEGORY_COUNTS = `SELECT c.Category_id AS id, c.Name AS name, COUNT(p.Product_id) AS productCount
      FROM CATEGORY c LEFT JOIN PRODUCT p ON p.Category_id = c.Category_id AND p.Is_active = 1 AND p.Marked_for_deletion = 0
      WHERE c.Marked_for_deletion = 0 GROUP BY c.Category_id, c.Name ORDER BY c.Name`;
const SORTS = { name: 'name, id', price_asc: 'effectivePrice, id', price_desc: 'effectivePrice DESC, id', rating: 'rating DESC, reviewCount DESC, id', newest: 'id DESC' };

module.exports = route({
  GET: async (req) => {
    const q = req.query || {};
    const params = {};
    const conditions = [PUBLIC_PRODUCT];
    const page = q.page === undefined ? 1 : validate.integer(q.page, 'Page', { max: 100000 });
    const pageSize = q.pageSize === undefined ? 12 : validate.integer(q.pageSize, 'Page size', { max: 48 });
    const sort = q.sort || 'name';
    if (!Object.hasOwn(SORTS, sort)) throw new HttpError(400, 'Choose a valid sort option.');
    if (q.search) {
      const search = validate.text(q.search, 'Search', { max: 100 }).replace(/[~%_\[]/g, '~$&');
      params.search = `%${search}%`;
      conditions.push("(p.Name LIKE @search ESCAPE '~' OR p.SKU LIKE @search ESCAPE '~')");
    }
    if (q.categoryId) { params.categoryId = id(q.categoryId, 'Category'); conditions.push('p.Category_id = @categoryId'); }
    if (q.condition) {
      if (!['New', 'Used', 'Refurbished'].includes(q.condition)) throw new HttpError(400, 'Choose a valid condition.');
      params.condition = q.condition; conditions.push('p.Product_condition = @condition');
    }
    if (q.discountId) {
      params.discountId = id(q.discountId, 'Discount');
      conditions.push(`(p.Discount_id = @discountId OR c.Discount_id = @discountId) AND EXISTS
        (SELECT 1 FROM DISCOUNT linked WHERE linked.Discount_id = @discountId AND linked.Is_active = 1
          AND linked.Marked_for_deletion = 0 AND CAST(SYSDATETIME() AS DATE) BETWEEN linked.Start_date AND linked.End_date)`);
    }
    if (q.inStock === 'true') conditions.push('p.Stock_quantity > 0');
    for (const field of ['minPrice', 'maxPrice']) {
      if (q[field] !== undefined && q[field] !== '') {
        const value = Number(q[field]);
        if (!Number.isFinite(value) || value < 0 || value > 99999999.99 || !/^\d+(\.\d{1,2})?$/.test(String(q[field]))) throw new HttpError(400, 'Enter a valid price with up to two decimal places.');
        params[field] = { type: sql.Decimal(10, 2), value };
        conditions.push(`(p.Sell_price - ISNULL(offer.saving, 0)) ${field === 'minPrice' ? '>=' : '<='} @${field}`);
      }
    }
    if (params.minPrice && params.maxPrice && params.minPrice.value > params.maxPrice.value) throw new HttpError(400, 'Minimum price cannot exceed maximum price.');
    const select = `${productSelect()} FROM PRODUCT p ${PRODUCT_JOINS()} WHERE ${conditions.join(' AND ')}`;
    const withCategories = q.withCategories === 'true';
    const result = await query(`WITH products AS (${select}) SELECT * FROM products ORDER BY ${SORTS[sort]}
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
      SELECT COUNT(*) AS total FROM PRODUCT p ${PRODUCT_JOINS()} WHERE ${conditions.join(' AND ')}${withCategories ? `;
      ${CATEGORY_COUNTS}` : ''}`, { ...params, offset: (page - 1) * pageSize, pageSize });
    const body = { products: result.recordsets[0], total: result.recordsets[1][0].total, page, pageSize };
    if (withCategories) body.categories = result.recordsets[2];
    return body;
  },
});
