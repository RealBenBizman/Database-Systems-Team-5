USE pos_store;
GO

-- PRICE CHANGE with checks
DECLARE @productId  INT           = (SELECT TOP 1 Product_id FROM PRODUCT WHERE Is_active = 1 ORDER BY Product_id);
DECLARE @employeeId INT           = (SELECT TOP 1 Employee_id FROM EMPLOYEE WHERE Role = 'Manager');
DECLARE @newPrice   DECIMAL(10,2) = 19.99;
DECLARE @testMode   BIT           = 1;   -- 1 = undo at the end, 0 = keep the change

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @oldPrice DECIMAL(10,2) = (SELECT Sell_price FROM PRODUCT WHERE Product_id = @productId);

    IF @oldPrice IS NULL     THROW 50041, 'Product not found.', 1;
    IF @newPrice < 0         THROW 50042, 'Price cannot be negative.', 1;
    IF @newPrice = @oldPrice THROW 50043, 'New price is the same as the current price.', 1;

    INSERT INTO PRICE_CHANGE (Product_id, Employee_id, Old_price, New_price)
    VALUES (@productId, @employeeId, @oldPrice, @newPrice);

    UPDATE PRODUCT
    SET    Sell_price = @newPrice
    WHERE  Product_id = @productId;

    SELECT p.Product_id, p.Sell_price, c.Old_price, c.New_price
    FROM   PRODUCT p
    JOIN   PRICE_CHANGE c ON c.Product_id = p.Product_id
    WHERE  p.Product_id = @productId;

    IF @testMode = 1 ROLLBACK TRANSACTION; ELSE COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;