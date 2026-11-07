/*
    tier_reward_triggers.sql - the two business-rule triggers of the loyalty tier reward.

      TR_CUSTOMER_TierReward          (trigger 14) gives the reward when CUSTOMER.Tier_id goes up
      TR_TRANSACTION_ITEM_RewardGuard (trigger 15) refuses an invalid or too large use (error 50011)

    The $500 cap (REWARD_CAP) is also in sp_Checkout and lib/storefront.js. The 15% and the 90 days
    live only in TR_CUSTOMER_TierReward.
*/
USE pos_store;
GO

-- TRIGGER 14: TR_CUSTOMER_TierReward
-- When CUSTOMER.Tier_id changes to a HIGHER tier (or from no tier to a tier):
--  a) insert the reward into DISCOUNT: 15% off, valid 90 days, code TIER-<customer>-<tier>
--  b) insert an 'offer' NOTIFICATION for the customer (only when Notify_offers = 1)
-- No reward when the tier goes down, stays the same, or this customer already earned that tier's
-- reward before (used or not). The loyalty trigger changes Tier_id, so this one runs by itself
-- at the end of the purchase chain.
CREATE OR ALTER TRIGGER TR_CUSTOMER_TierReward
ON CUSTOMER
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT UPDATE(Tier_id) RETURN;

    DECLARE @today DATE = CAST(SYSDATETIME() AS DATE);
    DECLARE @until DATE = DATEADD(DAY, 90, @today);

    -- Customers whose tier just went up and who have no reward for that tier yet
    DECLARE @up TABLE (Customer_id INT PRIMARY KEY, Tier_name NVARCHAR(50), Code VARCHAR(30), Notify_offers BIT);

    INSERT INTO @up (Customer_id, Tier_name, Code, Notify_offers)
    SELECT i.Customer_id, nt.Tier_name,
           CONCAT('TIER-', i.Customer_id, '-', nt.Tier_id),
           i.Notify_offers
    FROM   inserted i
    JOIN   deleted d         ON d.Customer_id = i.Customer_id
    JOIN   REWARD_TIER nt    ON nt.Tier_id    = i.Tier_id
    LEFT JOIN REWARD_TIER ot ON ot.Tier_id    = d.Tier_id
    WHERE  i.Marked_for_deletion = 0
      AND  (ot.Tier_id IS NULL OR nt.Min_points > ot.Min_points)
      AND  NOT EXISTS (SELECT 1 FROM DISCOUNT x
                       WHERE x.Code = CONCAT('TIER-', i.Customer_id, '-', nt.Tier_id));

    IF NOT EXISTS (SELECT 1 FROM @up) RETURN;

    -- a) the reward
    INSERT INTO DISCOUNT (Discount_name, Discount_type, Code, Amount, Amount_type,
                          Start_date, End_date, Sale_event_id, Is_active)
    SELECT CONCAT(N'Tier reward: ', u.Tier_name), 'tier reward', u.Code, 15.00, 'percent',
           @today, @until, NULL, 1
    FROM   @up u;

    -- b) the message (Discount_id stays NULL: the reward is not attached to any product)
    INSERT INTO NOTIFICATION (Customer_id, Notification_type, Message, Discount_id)
    SELECT u.Customer_id, 'offer',
           CONCAT('You reached ', u.Tier_name, '! Your next order gets 15% off (up to $500). Use it by ',
                  CONVERT(VARCHAR(10), @until, 23), '.'),
           NULL
    FROM   @up u
    WHERE  u.Notify_offers = 1;
END;
GO

-- TRIGGER 15: TR_TRANSACTION_ITEM_RewardGuard
-- When a TRANSACTION_ITEM line carries a tier reward (DISCOUNT.Code starts with 'TIER-'):
--  a) the reward must belong to the customer who owns the sale
--  b) the reward must still be valid: active, in date, and the customer still holds its tier
--     (VW_TIER_REWARD lists exactly those)
--  c) the line's saving cannot be more than the reward's percentage of the line
--  d) all reward savings on one sale together cannot be more than $500
-- Error 50011. Lines without a tier reward are not looked at.
CREATE OR ALTER TRIGGER TR_TRANSACTION_ITEM_RewardGuard
ON TRANSACTION_ITEM
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT (UPDATE(Discount_id) OR UPDATE(Discount_amount) OR UPDATE(Quantity) OR UPDATE(Unit_price)) RETURN;

    DECLARE @r TABLE (Transaction_id INT, Product_id INT, Sale_customer INT, Discount_id INT,
                      Reward_customer INT, Saving DECIMAL(10,2), Max_saving DECIMAL(10,2));

    INSERT INTO @r (Transaction_id, Product_id, Sale_customer, Discount_id, Reward_customer, Saving, Max_saving)
    SELECT i.Transaction_id, i.Product_id, s.Customer_id, i.Discount_id,
           TRY_CAST(SUBSTRING(d.Code, 6, 7) AS INT),
           i.Discount_amount,
           ROUND(i.Quantity * i.Unit_price * d.Amount / 100.0, 2)
    FROM   inserted i
    JOIN   DISCOUNT d          ON d.Discount_id    = i.Discount_id
    JOIN   SALES_TRANSACTION s ON s.Transaction_id = i.Transaction_id
    WHERE  d.Code LIKE 'TIER-%';

    IF NOT EXISTS (SELECT 1 FROM @r) RETURN;

    -- a) only the owner
    IF EXISTS (SELECT 1 FROM @r WHERE Reward_customer IS NULL OR Reward_customer <> Sale_customer)
        THROW 50011, 'A tier reward can only be used by the customer who earned it.', 1;

    -- b) still valid
    IF EXISTS (SELECT 1 FROM @r r
               WHERE NOT EXISTS (SELECT 1 FROM VW_TIER_REWARD v
                                 WHERE v.Customer_id = r.Sale_customer AND v.Discount_id = r.Discount_id))
        THROW 50011, 'This tier reward is not available any more.', 1;

    -- c) never more than the reward's percentage of the line
    IF EXISTS (SELECT 1 FROM @r WHERE Saving > Max_saving)
        THROW 50011, 'A tier reward cannot take more than its percentage off a line.', 1;

    -- d) at most $500 on one order
    IF EXISTS (SELECT 1
               FROM   TRANSACTION_ITEM ti
               JOIN   DISCOUNT d ON d.Discount_id = ti.Discount_id
               WHERE  d.Code LIKE 'TIER-%'
                 AND  ti.Transaction_id IN (SELECT Transaction_id FROM @r)
               GROUP BY ti.Transaction_id
               HAVING SUM(ti.Discount_amount) > 500.00)
        THROW 50011, 'A tier reward can save at most $500 on one order.', 1;
END;
GO