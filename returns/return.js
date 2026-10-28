
const { route, readBody, HttpError } = require('../../lib/http');
const { query, withTransaction } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');


function validId(value, name) {
    if (value == null || value === '') {
        throw new HttpError(400, `${name} is required.`, 'BAD_ID');
    }

    const id = Number(value);

    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new HttpError(400, `Invalid ${name}.`, 'BAD_ID');
    }

    return id;
}


function firstRow(result) {
    return result?.recordset?.[0] ??
           result?.[0] ??
           null;
}

function customerIdFromAuth(req) {
    const user = requireAuth(req, ['customer']);
    return validId(user.id, 'authenticated customer ID');
}

function employeeIdFromAuth(req) {
    const user = requireAuth(req, ['support', 'manager']);
    return validId(user.id, 'authenticated employee ID');
}

module.exports = route({


    GET: async (req) => {

        const user = requireAuth(req, ['customer', 'support', 'manager']);
        const role = user.role;

        if (role === 'customer') {
            const customerId = customerIdFromAuth(req);

            const result = await query(
                `SELECT
                    r.Return_id,
                    r.Transaction_id,
                    r.Reason,
                    r.Status,
                    r.Refund_total,
                    r.Requested_at,
                    r.Refunded_at
                 FROM PRODUCT_RETURN r
                 INNER JOIN SALES_TRANSACTION s
                    ON s.Transaction_id = r.Transaction_id
                 WHERE s.Customer_id = @customerId
                 ORDER BY r.Requested_at DESC`,
                { customerId }
            );

            return {
                status: 200,
                body: {
                    returns: result.recordset ?? result
                }
            };
        }

        const result = await query(
            `SELECT
                Return_id,
                Transaction_id,
                Employee_id,
                Reason,
                Status,
                Refund_total,
                Requested_at,
                Refunded_at
             FROM PRODUCT_RETURN
             ORDER BY Requested_at DESC`,
            {}
        );

        return {
            status: 200,
            body: {
                returns: result.recordset ?? result
            }
        };
    },


    POST: async (req) => {

        const user = requireAuth(req, ['customer']);
        const body = readBody(req);

        const transactionId = validId(body.transactionId, 'transaction ID');
        const customerId = validId(user.id, 'authenticated customer ID');
        const reason = body.reason;

        if (typeof reason !== 'string' ||
            !reason.trim() ||
            reason.length > 200) {
                throw new HttpError(
                    400,
                    'Return reason is required (maximum 200 characters).',
                    'BAD_REASON'
                );
            }

        if (!Array.isArray(body.items) || body.items.length === 0) {
            throw new HttpError(
                400,
                'At least one return item is required.',
                'BAD_ITEMS'
            );
        }
        const items = body.items.map(item => ({
            productId: validId(item?.productId, 'product ID'),
            quantity: validId(item?.quantity, 'quantity')
        }));

        const productIds = items.map(item => item.productId);

        if (new Set(productIds).size !== productIds.length) {
            throw new HttpError(
                400,
                'Duplicate products are not allowed in a return.',
                'DUPLICATE_PRODUCT'
            );
        }


        const returnId = await withTransaction(async (tx) => {
            const ownership = await tx.query(
                `SELECT Transaction_id
                FROM SALES_TRANSACTION WITH (UPDLOCK, HOLDLOCK)
                WHERE Transaction_id = @transactionId
                AND Customer_id = @customerId`,
                { transactionId, customerId }
        );

        if (!firstRow(ownership)) {
            throw new HttpError(
                403,
                'You cannot request a return for this transaction.',
                'RETURN_NOT_ALLOWED'
            );
        }

        const created = await tx.query(
            `EXEC dbo.RequestReturn
                @Transaction_ID = @transactionId,
                @Reason = @reason`,
            {
                transactionId,
                reason: reason.trim()
            }
        );

        const newReturnId = firstRow(created)?.Return_id;

        if (!newReturnId) {
            throw new Error('Return procedure did not provide a return ID.');
        }

        for (const item of items) {
            await tx.query(
                `EXEC dbo.AddReturnItem
                    @Return_id = @returnId,
                    @Product_id = @productId,
                    @Quantity = @quantity`,
                {
                    returnId: newReturnId,
                    productId: item.productId,
                    quantity: item.quantity
                }
            );
        }

        return newReturnId;
    });

    return {
        status: 201,
        body: {
            message: 'Return requested successfully.',
            returnId
        }
    };
    },


    PATCH: async (req) => {

        requireAuth(req, ['customer']);

        const body = readBody(req);

        const returnId = validId(
            body.returnId,
            'return ID'
        );

        const productId = validId(
            body.productId,
            'product ID'
        );

        const quantity = validId(
            body.quantity,
            'quantity'
        );

        const customerId = customerIdFromAuth(req);


        const ownership = await query(
            `SELECT r.Return_id
             FROM PRODUCT_RETURN r
             INNER JOIN SALES_TRANSACTION s
                ON s.Transaction_id = r.Transaction_id
             WHERE r.Return_id = @returnId
               AND s.Customer_id = @customerId
               AND r.Status = 'requested'`,
            {
                returnId,
                customerId
            }
        );

        if (!firstRow(ownership)) {
            throw new HttpError(
                403,
                'Return not found, not yours, or no longer editable.',
                'RETURN_NOT_EDITABLE'
            );
        }

        const result = await query(
            `EXEC dbo.AddReturnItem
                @Return_id = @returnId,
                @Product_id = @productId,
                @Quantity = @quantity`,
            {
                returnId,
                productId,
                quantity
            }
        );

        return {
            status: 200,
            body: {
                message: 'Return item added successfully.',
                item: firstRow(result)
            }
        };
    },

    PUT: async (req) => {

        requireAuth(req, ['support', 'manager']);

        const body = readBody(req);

        const returnId = validId(
            body.returnId,
            'return ID'
        );

        const employeeId = employeeIdFromAuth(req);
        const action = body.action;

        let procedure;
        let message;

        switch (action) {

            case 'approve':
                procedure = 'dbo.ApproveReturn';
                message = 'Return approved successfully.';
                break;

            case 'deny':
                procedure = 'dbo.DenyReturn';
                message = 'Return denied successfully.';
                break;

            case 'refund':
                procedure = 'dbo.RefundReturn';
                message = 'Return refunded successfully.';
                break;

            default:
                throw new HttpError(
                    400,
                    'Action must be approve, deny, or refund.',
                    'BAD_RETURN_ACTION'
                );
        }

        const result = await query(
            `EXEC ${procedure}
                @Return_id = @returnId,
                @Employee_id = @employeeId`,
            {
                returnId,
                employeeId
            }
        );

        return {
            status: 200,
            body: {
                message,
                return: firstRow(result)
            }
        };
    }

});
