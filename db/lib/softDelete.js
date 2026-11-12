/*
   lib/softDelete.js - "removing" a row means flagging it, never deleting it

   Every table has Marked_for_deletion, every query filters it out, and the app's
   database login is not allowed to DELETE rows. So the only way to remove
   something is this helper:

     await db.withTransaction(async (tx) => {
       // ...check the rules for this removal first (see docs/remove-pattern.md)...
       await softDelete(tx, 'PRODUCT', 'Product_id', productId, 'Product');
     });

   It flags the row and throws HttpError 404 when nothing changed (the id does not
   exist, or the row was already removed), so a double click or a stale page gets a
   clear message instead of silently doing nothing.

   Table and column names are written in the list below, never taken from the
   request. A name that is not in the list is a programming mistake and throws a
   plain Error (the client sees a generic 500).

   Tables whose key has two columns (SUPPLIER_PRODUCT, CART_ITEM, ...) are not in
   the list: write that one UPDATE by hand in the endpoint.
*/

const { HttpError } = require('./http');

const REMOVABLE = {
    PRODUCT: 'Product_id',
    CATEGORY: 'Category_id',
    DISCOUNT: 'Discount_id',
    SALE_EVENT: 'Sale_event_id',
    SUPPLIER: 'Supplier_id',
    TAX_RATE: 'Tax_rate_id',
    REWARD_PROGRAM: 'Program_id',
    REWARD_TIER: 'Tier_id',
    REVIEW: 'Review_id',
    NOTIFICATION: 'Notification_id',
    CUSTOMER: 'Customer_id',
    CUSTOMER_ADDRESS: 'Address_id',
    EMPLOYEE: 'Employee_id',
};

//tx: the object db.withTransaction gives you (tx.query(text, params))
//label: the world used in the 404 message, for example 'Product.
async function softDelete(tx, table, idColumn, id, label = 'Item') {
    if (!Object.prototype.hasOwnProperty.call(REMOVABLE, table) || REMOVABLE[table] !== idColumn) {
        throw new Error(`softDelete: ${table}.${idColumn} is not on the list of removable tables`);
    }

    //No output clause: it is not allowed on tables that have triggers (Product has one).
    const result = await tx.query(
        `UPDATE ${table} SET Marked_for_deletion = 1 WHERE ${idColumn} = @id AND Marked_for_deletion = 0`,
        { id },
    );

    const changed = result && result.rowsAffected ? result.rowsAffected[0] : 0;
    if (!changed) throw new HttpError(404, `${label} not found.`, 'NOT_FOUND');
    return { ok: true };
}

module.exports = { softDelete, REMOVABLE };