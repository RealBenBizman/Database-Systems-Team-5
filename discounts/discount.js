const { route, readBody, HttpError } = require('../../lib/http');
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

module.exports = route({

    POST: async (req) => {

        requireAuth(req, ['manager']);

        const body = readBody(req);

        const discountName = String(body.discountName || '').trim();
        const discountType = body.discountType;
        const code = body.code;
        const amount = Number(body.amount);
        const amountType = body.amountType;
        const startDate = body.startDate;
        const endDate = body.endDate;
        const saleEventId = body.saleEventId ?? null;

        if (!discountName) {
            throw new HttpError(400, 'Discount name is required.', 'BAD_DISCOUNT_NAME');
        }

        if (!['percent', 'fixed'].includes(discountType) ||
            !['percent', 'fixed'].includes(amountType)) {
            throw new HttpError(400, 'Invalid discount type.', 'BAD_DISCOUNT_TYPE');
        }

        if (body.amount == null || body.amount === '' ||
            !Number.isFinite(amount) || amount <= 0 ||
            (amountType === 'percent' && amount > 100)) {
            throw new HttpError(400, 'Invalid discount amount.', 'BAD_AMOUNT');
        }

        if (!startDate || !endDate) {
            throw new HttpError(400, 'Start and end dates are required.', 'BAD_DATES');
        }

        await query(
            `EXEC dbo.CreateDiscount
                @Discount_name = @discountName,
                @Discount_type = @discountType,
                @Code = @code,
                @Amount = @amount,
                @Amount_type = @amountType,
                @Start_date = @startDate,
                @End_date = @endDate,
                @Sale_event_id = @saleEventId`,
            {
                discountName,
                discountType,
                code: code ?? null,
                amount,
                amountType,
                startDate,
                endDate,
                saleEventId
            }
        );

        return {
            status: 201,
            body: {
                message: 'Discount created successfully.'
            }
        };
    },
    PATCH: async(req) => {
            requireAuth(req, ['manager']);

        const body = readBody(req);

        const discountId = Number(body.discountId);

        if (!Number.isInteger(discountId) || discountId <= 0) {
            throw new HttpError(
                400,
                'Valid discount ID is required.',
                'BAD_DISCOUNT_ID'
            );
        }
        const discountName = body.discountName ?? null;
        const discountType = body.discountType ?? null;
        const code = body.code ?? null;
        const amount = body.amount == null ? null : Number(body.amount);
        const amountType = body.amountType ?? null;
        const startDate = body.startDate ?? null;
        const endDate = body.endDate ?? null;
        const saleEventId = body.saleEventId == null
            ? null
            : Number(body.saleEventId);
        if (discountName !== null &&
            (typeof discountName !== 'string' || !discountName.trim())) {
        throw new HttpError(400, 'Invalid discount name.', 'BAD_DISCOUNT_NAME');
        }

        if (discountType !== null &&
            !['percent', 'fixed'].includes(discountType)) {
            throw new HttpError(400, 'Invalid discount type.', 'BAD_DISCOUNT_TYPE');
        }

        if (amountType !== null &&
            !['percent', 'fixed'].includes(amountType)) {
            throw new HttpError(400, 'Invalid amount type.', 'BAD_AMOUNT_TYPE');
        }

        if (amount !== null &&
            (!Number.isFinite(amount) || amount <= 0 ||
            (amountType === 'percent' && amount > 100))) {
            throw new HttpError(400, 'Invalid discount amount.', 'BAD_AMOUNT');
        }

        if (saleEventId !== null &&
            (!Number.isInteger(saleEventId) || saleEventId <= 0)) {
            throw new HttpError(400, 'Invalid sale event ID.', 'BAD_SALE_EVENT_ID');
        }

        await query(
            `EXEC dbo.UpdateDiscount
            @Discount_id = @discountId,
            @Discount_name = @discountName,
            @Discount_type = @discountType,
            @Code = @code,
            @Amount = @amount,
            @Amount_type = @amountType,
            @Start_date = @startDate,
            @End_date = @endDate,
            @Sale_event_id = @saleEventId`,
            {
                discountId,
                discountName,
                discountType,
                code,
                amount,
                amountType,
                startDate,
                endDate,
                saleEventId
            }
        );

        return {
            status: 200,
            body: {
                message: 'Discount updated successfully.'
            }
        };
    },
        DELETE: async (req) => {

        requireAuth(req, ['manager']);

        const body = readBody(req);

        const discountId = Number(body.discountId);

        if (body.discountId == null ||
            body.discountId === '' ||
            !Number.isInteger(discountId) ||
            discountId <= 0) {
            throw new HttpError(
                400,
                'Valid discount ID is required.',
                'BAD_DISCOUNT_ID'
            );
        }

        await query(
            `EXEC dbo.DeactivateDiscount
                @Discount_id = @discountId`,
            {
                discountId
            }
        );

        
        return {
            status: 200,
            body: {
                message: 'Discount deactivated successfully.'
            }
        };

    }
});
