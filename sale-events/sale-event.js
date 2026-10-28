
const { route, readBody, HttpError } = require('../../lib/http');
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

module.exports = route({

    POST: async (req) => {

        requireAuth(req, ['manager']);

        const body = readBody(req);

        const eventName = String(body.eventName ?? '').trim();
        const description = body.description;
        const startDate = body.startDate;
        const endDate = body.endDate;

        if (!eventName || eventName.length > 100) {
            throw new HttpError(
                400,
                'Valid event name is required (maximum 100 characters).',
                'BAD_EVENT_NAME'
            );
        }

        if (description != null &&
            (typeof description !== 'string' ||
            description.length > 500)) {
            throw new HttpError(
                400,
                'Valid description is required (maximum 500 characters).',
                'BAD_DESCRIPTION'
            );
        }

        const isValidDate = (value) => {
            if (typeof value !== 'string' ||
                !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                return false;
            }

            const date = new Date(value);
            return !Number.isNaN(date.getTime()) &&
                date.toISOString().slice(0, 10) === value;
        };

        if (!isValidDate(startDate) || !isValidDate(endDate)) {
            throw new HttpError(
                400,
                'Valid start and end dates are required.',
                'BAD_DATES'
            );
        }

        if (startDate > endDate) {
            throw new HttpError(
                400,
                'Start date cannot be after end date.',
                'BAD_DATE_RANGE'
            );
        }

        await query(
            `EXEC dbo.CreateSaleEvent
                @Event_name = @eventName,
                @Description = @description,
                @Start_date = @startDate,
                @End_date = @endDate`,
            {
                eventName,
                description: description ?? null,
                startDate,
                endDate
            }
        );

        return {
            status: 201,
            body: {
                message: 'Sale event created successfully.'
            }
        };
    },
    PATCH: async (req) => {

        requireAuth(req, ['manager']);

        const body = readBody(req);

        const saleEventId = Number(body.saleEventId);
        const eventName = body.eventName;
        const description = body.description;
        const startDate = body.startDate;
        const endDate = body.endDate;

        if (body.saleEventId == null ||
            body.saleEventId === '' ||
            !Number.isInteger(saleEventId) ||
            saleEventId <= 0) {
            throw new HttpError(
                400,
                'Valid sale event ID is required.',
                'BAD_SALE_EVENT_ID'
            );
        }

        if (typeof eventName !== 'string' ||
            !eventName.trim() ||
            eventName.length > 100) {
            throw new HttpError(
                400,
                'Valid event name is required (maximum 100 characters).',
                'BAD_EVENT_NAME'
            );
        }

        if (description != null &&
            (typeof description !== 'string' ||
             description.length > 500)) {
            throw new HttpError(
                400,
                'Invalid event description.',
                'BAD_DESCRIPTION'
            );
        }

        const isValidDate = (value) => {
            if (typeof value !== 'string' ||
                !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                return false;
            }

            const date = new Date(value);
            return !Number.isNaN(date.getTime()) &&
                date.toISOString().slice(0, 10) === value;
        };

        if (!isValidDate(startDate) || !isValidDate(endDate)) {
            throw new HttpError(
                400,
                'Valid start and end dates are required.',
                'BAD_DATES'
            );
        }

        if (startDate > endDate) {
            throw new HttpError(
                400,
                'Start date cannot be after end date.',
                'BAD_DATE_RANGE'
            );
        }

        await query(
            `EXEC dbo.UpdateSaleEvent
                @Sale_event_id = @saleEventId,
                @Event_name = @eventName,
                @Description = @description,
                @Start_date = @startDate,
                @End_date = @endDate`,
            {
                saleEventId,
                eventName: eventName.trim(),
                description: description ?? null,
                startDate,
                endDate
            }
        );

        return {
            status: 200,
            body: {
                message: 'Sale event updated successfully.'
            }
        };
    },

    DELETE: async (req) => {

        requireAuth(req, ['manager']);

        const body = readBody(req);

        const saleEventId = Number(body.saleEventId);

        if (body.saleEventId == null ||
            body.saleEventId === '' ||
            !Number.isInteger(saleEventId) ||
            saleEventId <= 0) {
            throw new HttpError(
                400,
                'Valid sale event ID is required.',
                'BAD_SALE_EVENT_ID'
            );
        }

        await query(
            `EXEC dbo.DeactivateSaleEvent
                @Sale_event_id = @saleEventId`,
            {
                saleEventId
            }
        );

        return {
            status: 200,
            body: {
                message: 'Sale event deactivated successfully.'
            }
        };
    }

});
