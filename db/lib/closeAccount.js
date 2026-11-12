/*
   lib/closeAccount.js - closing a customer account (used by the customer and by a manager)

     await db.withTransaction((tx) => closeCustomer(tx, customerId, { self: true }));

   What happens: the customer row is flagged (nothing is deleted), the cart is emptied, and the person can no
   longer sign in. Orders, returns, reviews and rewards stay in the database so reports keep adding up; reviews
   disappear from the shop because they only show for customers who are not flagged. The email stays reserved.
   A customer with a return that is still open (requested or approved) cannot be closed: the refund has to be finished first.
*/
const { HttpError } = require('./http');
const { softDelete } = require('./softDelete');

async function closeCustomer(tx, customerId, { self = false } = {}) {
  const found = await tx.query(
    'SELECT Customer_id FROM CUSTOMER WITH (UPDLOCK, HOLDLOCK) WHERE Customer_id = @customerId AND Marked_for_deletion = 0',
    { customerId });
  if (found.recordset.length === 0) throw new HttpError(404, 'Customer not found.', 'NOT_FOUND');

  const open = await tx.query(
    `SELECT COUNT(*) AS n
     FROM   PRODUCT_RETURN r
     JOIN   SALES_TRANSACTION s ON s.Transaction_id = r.Transaction_id
     WHERE  s.Customer_id = @customerId AND r.Status IN ('requested', 'approved') AND r.Marked_for_deletion = 0`,
    { customerId });
  if (open.recordset[0].n > 0) {
    throw new HttpError(409,
      `${self ? 'You have' : 'This customer has'} a return that is still open. It must be refunded or denied before the account can be closed.`,
      'OPEN_RETURN');
  }

  // CART_ITEM is the one table the app may really delete from; a closed customer has no use for a cart
  await tx.query('DELETE FROM CART_ITEM WHERE Customer_id = @customerId', { customerId });
  await softDelete(tx, 'CUSTOMER', 'Customer_id', customerId, 'Customer');
}

module.exports = { closeCustomer };
