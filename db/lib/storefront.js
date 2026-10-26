const db = require('./db');
const { requireAuth } = require('./auth');
const { HttpError } = require('./http');
const validate = require('./validate');

function id(value, label = 'ID') {
  return validate.integer(value, label, { min: 1000000, max: 9999999 });
}

function keys(body, allowed) {
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new HttpError(400, 'The request contains an unsupported field.');
  }
}

function boolean(value, label) {
  if (typeof value !== 'boolean') throw new HttpError(400, `${label} must be true or false.`);
  return value;
}

async function customer(req) {
  const user = requireAuth(req, ['customer']);
  const result = await db.query('SELECT Customer_id FROM CUSTOMER WHERE Customer_id = @customerId AND Marked_for_deletion = 0', { customerId: user.id });
  if (!result.recordset.length) throw new HttpError(401, 'Please sign in again.');
  return user;
}

async function lockCustomer(tx, customerId) {
  const result = await tx.query('SELECT Customer_id FROM CUSTOMER WITH (UPDLOCK, HOLDLOCK) WHERE Customer_id = @customerId AND Marked_for_deletion = 0', { customerId });
  if (!result.recordset.length) throw new HttpError(401, 'Please sign in again.');
}

function productSelect(quantity = '1') {
  return `SELECT p.Product_id AS id, p.SKU AS sku, p.Name AS name,
    p.Description AS description, p.Sell_price AS price,
    p.Stock_quantity AS stock, p.Product_condition AS condition,
    CAST(CASE WHEN p.Is_active = 1 AND c.Marked_for_deletion = 0 THEN 1 ELSE 0 END AS BIT) AS isActive,
    c.Category_id AS categoryId, c.Name AS category,
    CAST(${quantity} AS INT) AS quantity,
    CAST(p.Sell_price * ${quantity} AS DECIMAL(28,2)) AS baseTotal,
    CAST(ISNULL(offer.saving, 0) AS DECIMAL(28,2)) AS discountAmount,
    CAST(p.Sell_price * ${quantity} - ISNULL(offer.saving, 0) AS DECIMAL(28,2)) AS lineTotal,
    CAST((p.Sell_price * ${quantity} - ISNULL(offer.saving, 0)) / ${quantity} AS DECIMAL(18,2)) AS effectivePrice,
    offer.Discount_id AS discountId, offer.Discount_name AS discountName,
    CAST(ISNULL(r.rating, 0) AS DECIMAL(3,2)) AS rating, ISNULL(r.reviewCount, 0) AS reviewCount,
    CAST(CASE WHEN p.Is_active = 1 AND c.Marked_for_deletion = 0 AND p.Stock_quantity >= ${quantity}
      THEN 1 ELSE 0 END AS BIT) AS available`;
}

const PRODUCT_JOINS = (quantity = '1') => `JOIN CATEGORY c ON c.Category_id = p.Category_id
  OUTER APPLY (
    SELECT TOP (1) d.Discount_id, d.Discount_name,
      CASE WHEN saving.rawSaving > p.Sell_price * ${quantity}
        THEN p.Sell_price * ${quantity} ELSE saving.rawSaving END AS saving
    FROM DISCOUNT d
    CROSS APPLY (SELECT ROUND(CASE WHEN d.Amount_type = 'percent'
      THEN p.Sell_price * ${quantity} * d.Amount / 100.0 ELSE d.Amount END, 2) AS rawSaving) saving
    WHERE (d.Discount_id = p.Discount_id OR d.Discount_id = c.Discount_id)
      AND d.Marked_for_deletion = 0 AND d.Is_active = 1
      AND CAST(SYSDATETIME() AS DATE) BETWEEN d.Start_date AND d.End_date
    ORDER BY saving DESC, d.Discount_id
  ) offer
  OUTER APPLY (
    SELECT AVG(CAST(rv.Rating AS DECIMAL(5,2))) AS rating, COUNT(*) AS reviewCount
    FROM REVIEW rv JOIN CUSTOMER author ON author.Customer_id = rv.Customer_id
    WHERE rv.Product_id = p.Product_id AND rv.Marked_for_deletion = 0 AND author.Marked_for_deletion = 0
  ) r`;

const PUBLIC_PRODUCT = 'p.Marked_for_deletion = 0 AND p.Is_active = 1 AND c.Marked_for_deletion = 0';

function cartResult(rows) {
  const first = rows[0];
  return {
    items: rows.map(({ cartSubtotal, cartQuantity, ...item }) => item),
    subtotal: first ? Number(first.cartSubtotal) : 0,
    itemCount: first ? Number(first.cartQuantity) : 0,
  };
}

async function readCart(customerId) {
  const result = await db.query(`WITH items AS (
    ${productSelect('v.Quantity')} FROM VW_CART v
    JOIN PRODUCT p ON p.Product_id = v.Product_id ${PRODUCT_JOINS('v.Quantity')}
    WHERE v.Customer_id = @customerId
  ) SELECT *, SUM(lineTotal) OVER () AS cartSubtotal, SUM(CAST(quantity AS BIGINT)) OVER () AS cartQuantity
    FROM items ORDER BY name, id`, { customerId });
  return cartResult(result.recordset);
}

function cartItems(value) {
  if (!Array.isArray(value) || value.length > 100) throw new HttpError(400, 'A cart can contain up to 100 different products.');
  const seen = new Set();
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new HttpError(400, 'Invalid cart item.');
    keys(item, ['productId', 'quantity']);
    const productId = id(item.productId, 'Product');
    const quantity = validate.integer(item.quantity, 'Quantity');
    if (seen.has(productId)) throw new HttpError(400, 'A product appears more than once in the cart.');
    seen.add(productId);
    return { productId, quantity };
  });
}

async function saveCartItem(tx, customerId, productId, amount, mode = 'add') {
  const productResult = await tx.query(`SELECT p.Stock_quantity AS stock FROM PRODUCT p
    JOIN CATEGORY c ON c.Category_id = p.Category_id
    WHERE p.Product_id = @productId AND p.Marked_for_deletion = 0 AND p.Is_active = 1 AND c.Marked_for_deletion = 0`, { productId });
  if (!productResult.recordset.length) throw new HttpError(409, 'This product is no longer available.');
  const existing = await tx.query(`SELECT Quantity AS quantity, Marked_for_deletion AS deleted
    FROM CART_ITEM WITH (UPDLOCK, HOLDLOCK) WHERE Customer_id = @customerId AND Product_id = @productId`, { customerId, productId });
  const row = existing.recordset[0];
  const oldQuantity = row && !row.deleted ? row.quantity : 0;
  const quantity = mode === 'add' ? oldQuantity + amount : mode === 'merge' ? Math.max(oldQuantity, amount) : amount;
  if (!Number.isSafeInteger(quantity) || quantity > 2147483647) throw new HttpError(400, 'The quantity is too large.');
  if (quantity > productResult.recordset[0].stock) throw new HttpError(409, `Only ${productResult.recordset[0].stock} are in stock.`);
  if (mode === 'set' && !oldQuantity) throw new HttpError(404, 'This item is not in your cart.');
  const params = { customerId, productId, quantity };
  if (row) {
    await tx.query(`UPDATE CART_ITEM SET Quantity = @quantity, Added_at = SYSDATETIME(), Marked_for_deletion = 0
      WHERE Customer_id = @customerId AND Product_id = @productId`, params);
  } else {
    const count = await tx.query(`SELECT COUNT(*) AS count FROM CART_ITEM ci JOIN PRODUCT p ON p.Product_id = ci.Product_id
      WHERE ci.Customer_id = @customerId AND ci.Marked_for_deletion = 0 AND p.Marked_for_deletion = 0`, { customerId });
    if (count.recordset[0].count >= 100) throw new HttpError(409, 'Your cart has reached 100 different products.');
    await tx.query('INSERT INTO CART_ITEM (Customer_id, Product_id, Quantity) VALUES (@customerId, @productId, @quantity)', params);
  }
}

async function removeCartItem(tx, customerId, productId) {
  const result = await tx.query('DELETE FROM CART_ITEM OUTPUT deleted.Product_id AS id WHERE Customer_id = @customerId AND Product_id = @productId', { customerId, productId });
  if (!result.recordset.length) throw new HttpError(404, 'This item is not in your cart.');
}

const ADDRESS_COLUMNS = `Address_id AS id, Address_type AS type, Recipient_name AS recipient,
  Street AS street, Apt AS apt, City AS city, State AS state, Zip AS zip, is_default AS isDefault`;

function address(body) {
  keys(body, ['id', 'type', 'recipient', 'street', 'apt', 'city', 'state', 'zip', 'isDefault']);
  const state = validate.text(body.state, 'State', { min: 2, max: 2 }).toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw new HttpError(400, 'Use the two-letter state abbreviation.');
  const zip = validate.text(body.zip, 'ZIP code', { min: 5, max: 10 });
  if (!/^\d{5}(-?\d{4})?$/.test(zip)) throw new HttpError(400, 'Enter a five-digit or nine-digit ZIP code.');
  return {
    type: validate.text(body.type, 'Address label', { max: 20 }),
    recipient: validate.text(body.recipient, 'Recipient', { max: 100 }),
    street: validate.text(body.street, 'Street', { max: 100 }),
    apt: body.apt ? validate.text(body.apt, 'Apartment', { max: 10 }) : null,
    city: validate.text(body.city, 'City', { max: 50 }), state, zip,
    isDefault: boolean(body.isDefault, 'Default address'),
  };
}

function phone(value) {
  const result = validate.text(value, 'Phone number', { max: 30 }).replace(/[\s().-]/g, '');
  if (!/^\+?\d{7,15}$/.test(result)) throw new HttpError(400, 'Enter a phone number with 7 to 15 digits.');
  return result;
}

module.exports = { id, keys, boolean, customer, lockCustomer, productSelect, PRODUCT_JOINS, PUBLIC_PRODUCT,
  readCart, cartItems, cartResult, saveCartItem, removeCartItem, ADDRESS_COLUMNS, address, phone };
