/*
    sp_checkout.sql - Part 2: turns a customer's cart into a completed order.

    Based on Terry's first version (same steps, same order). The team added: the customer
    lock, the savepoint, the stock and item checks (50041, 50044-50046), and the rule that a
    FIXED discount is taken once per line.

    Run AFTER schema.sql, triggers.sql and views.sql. It can be run again at any
    time (CREATE OR ALTER). Call it from the API, never from the browser:

        EXEC sp_Checkout @Customer_id = 1000001, @Method = 'credit', @Card_last4 = '4242';

    It returns one row: Transaction_id (the new order number).

    Everything happens in ONE transaction. If anything fails, nothing is saved
    and the cart is untouched.
      1. lock the customer row (a double click or a cart edit at the same time waits)
      2. check the cart, the payment details and the default address
      3. insert the sale as 'open' with the ship-to copied from the address
      4. copy each cart row to TRANSACTION_ITEM with its price and the single
         largest discount (product or category) that is active today
      5. empty the cart, work out Subtotal, Tax_amount and Total
      6. insert one PAYMENT for the full Total
      7. update the sale to 'completed' (tracking number, arrival in 5 days).
         The existing triggers then take the stock, add the loyalty points,
         update the tier and open low-stock alerts.

    Rules decided here (Part 2):
      - A percent discount is a share of the line (price x quantity).
        A FIXED discount is taken ONCE PER LINE, not once per unit. It matches
        the cart screen (lib/storefront.js), so the cart total and the charged
        total are always the same. A discount never goes below $0 for the line.
      - Ties between the product and the category discount go to the lower Discount_id.
      - Tax is rounded per line (after the discount), then added up. A missing
        tax rate stops the checkout; it is never treated as 0%. (A 0% rate must
        exist as a row, as it does for gift cards.)
      - The estimated arrival is 5 days after the order.

    Errors (the API shows these messages to the customer, status 409):
      50040 the cart is empty
      50041 an item is no longer for sale
      50042 no default shipping address
      50043 no tax rate for an item in the shipping state
      50044 not enough stock for an item
      50045 the customer was not found
      50046 payment method or card digits are not valid
*/
USE pos_store;
GO

CREATE OR ALTER PROCEDURE sp_Checkout
    @Customer_id INT,
    @Method      VARCHAR(10),
    @Card_last4  CHAR(4)
AS
BEGIN
    SET NOCOUNT ON;

    -- The API calls this with no transaction open, so the procedure owns its transaction.
    -- If a caller already has one open (db/checkout/test.sql does), it only undoes ITS OWN
    -- work on failure (a savepoint), instead of rolling back the caller's whole transaction.
    DECLARE @Own BIT = CASE WHEN @@TRANCOUNT = 0 THEN 1 ELSE 0 END;
    DECLARE @Today DATE = CAST(SYSDATETIME() AS DATE);
    DECLARE @Tid INT, @Subtotal DECIMAL(10,2), @Tax DECIMAL(10,2), @Msg NVARCHAR(200), @Item NVARCHAR(100);
    DECLARE @Name NVARCHAR(100), @Street NVARCHAR(100), @Apt VARCHAR(10),
            @City NVARCHAR(50), @State CHAR(2), @Zip VARCHAR(10);

    BEGIN TRY
        IF @Own = 1
            BEGIN TRANSACTION;
        ELSE
            SAVE TRANSACTION sp_Checkout_Start;

        -- 1) lock the customer: checkouts and cart edits for this customer run one at a time
        IF NOT EXISTS (SELECT 1 FROM CUSTOMER WITH (UPDLOCK, HOLDLOCK)
                       WHERE Customer_id = @Customer_id AND Marked_for_deletion = 0)
            THROW 50045, 'Please sign in again.', 1;

        -- 2) payment details, cart, items for sale, stock, address
        IF @Method IS NULL OR @Method NOT IN ('credit', 'debit')
            THROW 50046, 'Choose credit or debit.', 1;
        IF @Card_last4 IS NULL OR @Card_last4 LIKE '%[^0-9]%'
            THROW 50046, 'Enter the last 4 digits of the card.', 1;

        IF NOT EXISTS (SELECT 1 FROM VW_CART WHERE Customer_id = @Customer_id)
            THROW 50040, 'Your cart is empty.', 1;

        SET @Item = (SELECT TOP (1) p.Name
                     FROM VW_CART v
                     JOIN PRODUCT  p ON p.Product_id  = v.Product_id
                     JOIN CATEGORY c ON c.Category_id = p.Category_id
                     WHERE v.Customer_id = @Customer_id
                       AND (p.Is_active = 0 OR c.Marked_for_deletion = 1)
                     ORDER BY p.Name);
        IF @Item IS NOT NULL
        BEGIN
            SET @Msg = CONCAT(N'"', @Item, N'" is no longer for sale. Remove it from your cart to continue.');
            THROW 50041, @Msg, 1;
        END;

        SET @Item = (SELECT TOP (1) p.Name
                     FROM VW_CART v
                     JOIN PRODUCT p ON p.Product_id = v.Product_id
                     WHERE v.Customer_id = @Customer_id
                       AND v.Quantity > p.Stock_quantity
                     ORDER BY p.Name);
        IF @Item IS NOT NULL
        BEGIN
            SET @Msg = CONCAT(N'Not enough stock for "', @Item, N'". Update your cart and try again.');
            THROW 50044, @Msg, 1;
        END;

        SELECT TOP (1) @Name = Recipient_name, @Street = Street, @Apt = Apt,
                       @City = City, @State = State, @Zip = Zip
        FROM CUSTOMER_ADDRESS
        WHERE Customer_id = @Customer_id AND is_default = 1 AND Marked_for_deletion = 0
        ORDER BY Address_id;

        IF @State IS NULL
            THROW 50042, 'Add a default shipping address before checking out.', 1;

        -- 3) the open sale, with the ship-to copied (later address changes do not touch it)
        INSERT INTO SALES_TRANSACTION
            (Customer_id, Ship_name, Ship_street, Ship_apt, Ship_city, Ship_state, Ship_zip)
        VALUES (@Customer_id, @Name, @Street, @Apt, @City, @State, @Zip);
        SET @Tid = SCOPE_IDENTITY();

        -- 4) cart rows -> sale items (price snapshot + the single largest discount)
        INSERT INTO TRANSACTION_ITEM
            (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
        SELECT @Tid, v.Product_id, v.Quantity, v.Sell_price, best.Discount_id, ISNULL(best.Saving, 0)
        FROM VW_CART v
        JOIN PRODUCT  p ON p.Product_id  = v.Product_id
        JOIN CATEGORY c ON c.Category_id = p.Category_id
        OUTER APPLY (
            SELECT TOP (1) d.Discount_id,
                   CASE WHEN s.Raw > v.Line_total THEN v.Line_total ELSE s.Raw END AS Saving
            FROM DISCOUNT d
            CROSS APPLY (SELECT ROUND(CASE WHEN d.Amount_type = 'percent'
                                           THEN v.Line_total * d.Amount / 100.0
                                           ELSE d.Amount END, 2) AS Raw) s
            WHERE d.Discount_id IN (p.Discount_id, c.Discount_id)
              AND d.Is_active = 1 AND d.Marked_for_deletion = 0
              AND @Today BETWEEN d.Start_date AND d.End_date
            ORDER BY CASE WHEN s.Raw > v.Line_total THEN v.Line_total ELSE s.Raw END DESC, d.Discount_id
        ) best
        WHERE v.Customer_id = @Customer_id;

        -- 5) empty the cart; every line needs a tax rate for the ship-to state
        DELETE FROM CART_ITEM WHERE Customer_id = @Customer_id;

        IF EXISTS (SELECT 1
                   FROM TRANSACTION_ITEM ti
                   JOIN PRODUCT p ON p.Product_id = ti.Product_id
                   WHERE ti.Transaction_id = @Tid
                     AND NOT EXISTS (SELECT 1 FROM TAX_RATE tr
                                     WHERE tr.Category_id = p.Category_id
                                       AND tr.State = @State
                                       AND tr.Marked_for_deletion = 0
                                       AND @Today >= tr.Effective_from
                                       AND (tr.Effective_to IS NULL OR @Today <= tr.Effective_to)))
            THROW 50043, 'No tax rate was found for an item in your shipping state.', 1;

        SELECT @Subtotal = SUM(ti.Line_total),
               @Tax      = SUM(ROUND(ti.Line_total * r.Rate, 2))
        FROM TRANSACTION_ITEM ti
        JOIN PRODUCT p ON p.Product_id = ti.Product_id
        CROSS APPLY (SELECT TOP (1) tr.Rate
                     FROM TAX_RATE tr
                     WHERE tr.Category_id = p.Category_id
                       AND tr.State = @State
                       AND tr.Marked_for_deletion = 0
                       AND @Today >= tr.Effective_from
                       AND (tr.Effective_to IS NULL OR @Today <= tr.Effective_to)
                     ORDER BY tr.Effective_from DESC) r
        WHERE ti.Transaction_id = @Tid;

        UPDATE SALES_TRANSACTION
        SET Subtotal = @Subtotal, Tax_amount = @Tax, Total = @Subtotal + @Tax
        WHERE Transaction_id = @Tid;

        -- 6) one payment for the full Total (PAYMENT.Amount must be above 0)
        IF @Subtotal + @Tax > 0
            INSERT INTO PAYMENT (Transaction_id, Method, Amount, Card_last4)
            VALUES (@Tid, @Method, @Subtotal + @Tax, @Card_last4);

        -- 7) complete: the triggers take the stock, add points, update the tier, open alerts
        UPDATE SALES_TRANSACTION
        SET Status            = 'completed',
            Tracking_number   = CONCAT('TRK', @Tid),
            Estimated_arrival = DATEADD(DAY, 5, @Today)
        WHERE Transaction_id = @Tid;

        IF @Own = 1 COMMIT TRANSACTION;
        SELECT @Tid AS Transaction_id;
    END TRY
    BEGIN CATCH
        IF @Own = 1
        BEGIN
            IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        END
        ELSE IF XACT_STATE() = 1
            ROLLBACK TRANSACTION sp_Checkout_Start;
        THROW;
    END CATCH;
END;
GO
