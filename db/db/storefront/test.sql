USE pos_store;
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @customer INT, @other INT, @sale INT, @product INT, @outside INT;
SELECT TOP (1) @sale = s.Transaction_id, @customer = s.Customer_id, @product = ti.Product_id
FROM SALES_TRANSACTION s JOIN TRANSACTION_ITEM ti ON ti.Transaction_id = s.Transaction_id
WHERE s.Status = 'completed' AND s.Marked_for_deletion = 0 AND ti.Marked_for_deletion = 0
ORDER BY s.Transaction_id, ti.Product_id;
SELECT TOP (1) @other = Customer_id FROM CUSTOMER WHERE Customer_id <> @customer AND Marked_for_deletion = 0;
SELECT TOP (1) @outside = p.Product_id FROM PRODUCT p WHERE p.Marked_for_deletion = 0
  AND NOT EXISTS (SELECT 1 FROM TRANSACTION_ITEM ti WHERE ti.Transaction_id = @sale AND ti.Product_id = p.Product_id);
IF @sale IS NULL OR @other IS NULL OR @outside IS NULL
    THROW 51040, 'Load the shared seed data before running storefront tests.', 1;

BEGIN TRY
    BEGIN TRANSACTION;
    INSERT INTO REVIEW (Rating, Comment, Product_id, Customer_id, Transaction_id)
    VALUES (5, N'Storefront constraint test', @product, @customer, @sale),
           (4, NULL, @product, @customer, NULL);
    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

BEGIN TRY
    BEGIN TRANSACTION;
    INSERT INTO REVIEW (Rating, Product_id, Customer_id, Transaction_id) VALUES (5, @product, @other, @sale);
    THROW 51041, 'A review linked to another customer was accepted.', 1;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() <> 50004 THROW;
END CATCH;

BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @open INT;
    INSERT INTO SALES_TRANSACTION (Customer_id) VALUES (@customer);
    SET @open = SCOPE_IDENTITY();
    INSERT INTO REVIEW (Rating, Product_id, Customer_id, Transaction_id) VALUES (5, @product, @customer, @open);
    THROW 51042, 'A review linked to an unfinished sale was accepted.', 1;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() <> 50004 THROW;
END CATCH;

BEGIN TRY
    BEGIN TRANSACTION;
    INSERT INTO REVIEW (Rating, Product_id, Customer_id, Transaction_id) VALUES (5, @outside, @customer, @sale);
    THROW 51043, 'A review of an item outside the linked sale was accepted.', 1;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() <> 50004 THROW;
END CATCH;

BEGIN TRY
    BEGIN TRANSACTION;
    INSERT INTO REVIEW (Rating, Product_id, Customer_id, Transaction_id)
    VALUES (5, @product, @customer, @sale), (5, @product, @other, @sale);
    THROW 51044, 'A multi-row review insert containing an invalid link was accepted.', 1;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() <> 50004 THROW;
END CATCH;

SELECT 'PASS' AS Result, 'Storefront review constraints' AS Test;
