USE pos_store;
GO

CREATE OR ALTER PROCEDURE sp_Checkout
    @Customer_id INT,
    @Method      VARCHAR(10),
    @Card_last4  CHAR(4)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Today DATE = CAST(SYSDATETIME() AS DATE);
    DECLARE @Tid INT, @Subtotal DECIMAL(10,2), @Tax DECIMAL(10,2);
    DECLARE @Name NVARCHAR(100), @Street NVARCHAR(100), @Apt VARCHAR(10),
            @City NVARCHAR(50), @State CHAR(2), @Zip VARCHAR(10);

    IF NOT EXISTS (SELECT 1 FROM VW_CART WHERE Customer_id = @Customer_id)
        THROW 50040, 'Your cart is empty.', 1;

    IF EXISTS (SELECT 1 FROM VW_CART v JOIN PRODUCT p ON p.Product_id = v.Product_id
               WHERE v.Customer_id = @Customer_id AND p.Is_active = 0)
        THROW 50041, 'Your cart has an item that is no longer for sale.', 1;

    SELECT @Name = Recipient_name, @Street = Street, @Apt = Apt,
           @City = City, @State = State, @Zip = Zip
    FROM CUSTOMER_ADDRESS
    WHERE Customer_id = @Customer_id AND is_default = 1 AND Marked_for_deletion = 0;

    IF @State IS NULL
        THROW 50042, 'Add a default shipping address before checking out.', 1;

    BEGIN TRY
        BEGIN TRANSACTION;

        INSERT INTO SALES_TRANSACTION
            (Customer_id, Ship_name, Ship_street, Ship_apt, Ship_city, Ship_state, Ship_zip)
        VALUES (@Customer_id, @Name, @Street, @Apt, @City, @State, @Zip);
        SET @Tid = SCOPE_IDENTITY();

        INSERT INTO TRANSACTION_ITEM
            (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
        SELECT @Tid, v.Product_id, v.Quantity, v.Sell_price, best.Discount_id, ISNULL(best.Saving, 0)
        FROM VW_CART v
        JOIN PRODUCT p  ON p.Product_id  = v.Product_id
        JOIN CATEGORY c ON c.Category_id = p.Category_id
        OUTER APPLY (
            SELECT TOP (1) d.Discount_id,
                   CASE WHEN s.Raw > v.Line_total THEN v.Line_total ELSE s.Raw END AS Saving
            FROM DISCOUNT d
            CROSS APPLY (SELECT CASE WHEN d.Amount_type = 'percent'
                                     THEN ROUND(v.Line_total * d.Amount / 100, 2)
                                     ELSE d.Amount * v.Quantity END AS Raw) s
            WHERE d.Discount_id IN (p.Discount_id, c.Discount_id)
              AND d.Is_active = 1 AND d.Marked_for_deletion = 0
              AND @Today BETWEEN d.Start_date AND d.End_date
            ORDER BY s.Raw DESC
        ) best
        WHERE v.Customer_id = @Customer_id;

        DELETE FROM CART_ITEM WHERE Customer_id = @Customer_id;

        IF EXISTS (SELECT 1 FROM TRANSACTION_ITEM ti
                   JOIN PRODUCT p ON p.Product_id = ti.Product_id
                   WHERE ti.Transaction_id = @Tid
                     AND NOT EXISTS (SELECT 1 FROM TAX_RATE tr
                                     WHERE tr.Category_id = p.Category_id
                                       AND tr.State = @State
                                       AND tr.Marked_for_deletion = 0
                                       AND @Today >= tr.Effective_from
                                       AND (tr.Effective_to IS NULL OR @Today <= tr.Effective_to)))
            THROW 50043, 'No tax rate found for an item in your state.', 1;

        SELECT @Subtotal = SUM(ti.Line_total),
               @Tax      = SUM(ROUND(ti.Line_total * r.Rate, 2))
        FROM TRANSACTION_ITEM ti
        JOIN PRODUCT p ON p.Product_id = ti.Product_id
        CROSS APPLY (SELECT TOP (1) tr.Rate FROM TAX_RATE tr
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

        IF @Subtotal + @Tax > 0
            INSERT INTO PAYMENT (Transaction_id, Method, Amount, Card_last4)
            VALUES (@Tid, @Method, @Subtotal + @Tax, @Card_last4);

        UPDATE SALES_TRANSACTION
        SET Status = 'completed',
            Tracking_number = CONCAT('TRK', @Tid),
            Estimated_arrival = DATEADD(day, 5, @Today)
        WHERE Transaction_id = @Tid;

        COMMIT TRANSACTION;
        SELECT @Tid AS Transaction_id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO