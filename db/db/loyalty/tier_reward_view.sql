/*
    tier_reward.sql - loyalty tier reward: reaching a new tier earns 15% off the next order.

    Objects in this file
      VW_TIER_REWARD                      the one reward each customer can use right now
      TR_CUSTOMER_TierReward  (trigger 14) issues the reward when Tier_id goes up
      TR_TRANSACTION_ITEM_RewardGuard (15) refuses an invalid or too large use of a reward (error 50011)

    Numbers that live here and in sp_Checkout / lib/storefront.js: the $500 cap (REWARD_CAP). The 15%
    and the 90 days live only in TR_CUSTOMER_TierReward.
*/
USE pos_store;
GO

-- VIEW: the one tier reward each customer can use today (highest tier first).
CREATE OR ALTER VIEW VW_TIER_REWARD
AS
SELECT Customer_id, Discount_id, Discount_name, Percent_off, End_date, Reward_tier_id, Tier_name
FROM (
    SELECT r.Customer_id, r.Discount_id, r.Discount_name, r.Percent_off, r.End_date, r.Reward_tier_id,
           rt.Tier_name,
           ROW_NUMBER() OVER (PARTITION BY r.Customer_id ORDER BY rt.Min_points DESC, r.Discount_id) AS Rank_no
    FROM (
        SELECT d.Discount_id, d.Discount_name, d.Amount AS Percent_off, d.End_date,
               TRY_CAST(SUBSTRING(d.Code, 6, 7)  AS INT) AS Customer_id,
               TRY_CAST(SUBSTRING(d.Code, 14, 7) AS INT) AS Reward_tier_id
        FROM DISCOUNT d
        WHERE d.Code LIKE 'TIER-[0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
          AND d.Amount_type = 'percent'
          AND d.Is_active = 1 AND d.Marked_for_deletion = 0
          AND CAST(SYSDATETIME() AS DATE) BETWEEN d.Start_date AND d.End_date
    ) r
    JOIN CUSTOMER    c   ON c.Customer_id = r.Customer_id AND c.Marked_for_deletion = 0
    JOIN REWARD_TIER rt  ON rt.Tier_id    = r.Reward_tier_id
    JOIN REWARD_TIER cur ON cur.Tier_id   = c.Tier_id
    WHERE cur.Min_points >= rt.Min_points
) x
WHERE Rank_no = 1;
GO