/*
   seed_reviews.sql - product reviews for the demo customers (db/reports)

   WHY
     seed_analytics.sql adds about 70 customers and 550 sales but no reviews, so the product pages and
     the Reviews screen (/staff/reviews) are empty. This file adds about 90 reviews that fit that history.

   WHEN TO RUN
     Once, AFTER seed_analytics.sql has been run for real (it needs the customers @analytics.posstore.test
     and their completed sales). Data only: no table, view or trigger is changed and nothing existing is
     edited. Run it as one piece (there is no GO). It stops with a clear message, before changing
     anything, if the analytics data is missing or if the reviews were already added.

   REHEARSAL (the rolled-back test)
     Set @dry to 1 on the first line below and run it. The reviews are built, the check grid is printed
     and then ALL of it is rolled back. Set it back to 0 for the real run.

   WHAT IT CREATES
     Reviews written by the analytics customers, each one linked to a completed purchase of that same
     product (so the product page shows it as a verified purchase and the TR_REVIEW_Guard trigger accepts
     it). One review at most per customer and product. Gift cards are never reviewed.
       - about 14% of the other purchased products get a review, about 70% of the returned ones;
       - the rating follows the product: every product has its own fixed quality, the most returned
         product gets low ratings, returned items get 1 to 3 stars;
       - about 1 review in 5 with 3 stars or more has no comment, all low ratings have one;
       - the review date is 3 to 12 days after the purchase (never in the future).

   RANDOMNESS
     Nothing is random between runs. Every choice comes from a fixed MD5 hash of the item it is about
     (same method as seed_analytics.sql), so the same database gives the same reviews.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @dry BIT = 0;       -- 1 = rehearsal: build everything, print the grid, roll it all back
DECLARE @now DATETIME2 = SYSDATETIME();

DECLARE @r TABLE (Seq INT IDENTITY(1,1), Item NVARCHAR(120), Expected NVARCHAR(60), Actual NVARCHAR(60), Pass BIT NULL);

DECLARE @maxBefore INT, @problem INT;

-- Guards: stop before changing anything if the database is not ready

IF NOT EXISTS (SELECT 1 FROM CUSTOMER WHERE Email LIKE '%@analytics.posstore.test')
    THROW 50921, 'Review seed stopped: the analytics customers do not exist. Run db/reports/seed_analytics.sql first.', 1;

IF EXISTS (SELECT 1 FROM REVIEW rv JOIN CUSTOMER c ON c.Customer_id = rv.Customer_id
           WHERE c.Email LIKE '%@analytics.posstore.test')
    THROW 50920, 'Review seed stopped: the analytics customers already have reviews. Rebuild the database to run it again.', 1;

-- temp tables from an earlier run in the same query window would make SELECT INTO fail
DROP TABLE IF EXISTS #rv_line, #rv_dice, #rv_pick;

BEGIN TRY
    BEGIN TRAN;

    SELECT @maxBefore = ISNULL(MAX(Review_id), 0) FROM REVIEW;

    -- the most returned product among the analytics customers (it gets the low ratings)
    SELECT TOP (1) @problem = ri.Product_id
    FROM   PRODUCT_RETURN_ITEM ri
    JOIN   PRODUCT_RETURN r       ON r.Return_id = ri.Return_id
    JOIN   SALES_TRANSACTION s    ON s.Transaction_id = r.Transaction_id
    JOIN   CUSTOMER c             ON c.Customer_id = s.Customer_id
    WHERE  c.Email LIKE '%@analytics.posstore.test'
      AND  r.Marked_for_deletion = 0 AND ri.Marked_for_deletion = 0
    GROUP BY ri.Product_id
    ORDER BY COUNT(*) DESC, ri.Product_id;

    -- one candidate per customer and product: the purchase that was returned if there is one, else the first
    ;WITH l AS (
        SELECT s.Customer_id, ti.Product_id, s.Transaction_id, s.Transaction_date,
               CAST(CASE WHEN EXISTS (SELECT 1
                                      FROM   PRODUCT_RETURN r
                                      JOIN   PRODUCT_RETURN_ITEM ri ON ri.Return_id = r.Return_id
                                      WHERE  r.Transaction_id = s.Transaction_id AND ri.Product_id = ti.Product_id
                                        AND  r.Marked_for_deletion = 0 AND ri.Marked_for_deletion = 0)
                         THEN 1 ELSE 0 END AS INT) AS Returned
        FROM   SALES_TRANSACTION s
        JOIN   CUSTOMER c         ON c.Customer_id = s.Customer_id AND c.Marked_for_deletion = 0
        JOIN   TRANSACTION_ITEM ti ON ti.Transaction_id = s.Transaction_id AND ti.Marked_for_deletion = 0
        JOIN   PRODUCT p          ON p.Product_id = ti.Product_id AND p.Marked_for_deletion = 0 AND p.Is_active = 1
        JOIN   CATEGORY cat       ON cat.Category_id = p.Category_id AND cat.Marked_for_deletion = 0
        WHERE  c.Email LIKE '%@analytics.posstore.test'
          AND  s.Status = 'completed' AND s.Marked_for_deletion = 0
          AND  s.Transaction_date <= DATEADD(DAY, -3, @now)
          AND  cat.Name <> N'Gift Cards'
    ), k AS (
        SELECT l.*, ROW_NUMBER() OVER (PARTITION BY l.Customer_id, l.Product_id
                                       ORDER BY l.Returned DESC, l.Transaction_date, l.Transaction_id) AS rn
        FROM   l
    )
    SELECT k.Customer_id, k.Product_id, k.Transaction_id, k.Transaction_date, k.Returned
    INTO   #rv_line
    FROM   k
    WHERE  k.rn = 1;

    -- the fixed "dice" for every candidate (0 up to just under 1)
    SELECT l.Customer_id, l.Product_id, l.Transaction_id, l.Transaction_date, l.Returned,
           h.h_pick, h.h_noise, h.h_text, h.h_has, h.h_days, h.h_time, h.h_q
    INTO   #rv_dice
    FROM   #rv_line l
    CROSS APPLY (SELECT
        CAST(CAST(SUBSTRING(HASHBYTES('MD5', CONCAT('rv-pick-',  l.Customer_id, '-', l.Product_id)), 1, 4) AS BIGINT) AS FLOAT) / 4294967296.0 AS h_pick,
        CAST(CAST(SUBSTRING(HASHBYTES('MD5', CONCAT('rv-noise-', l.Customer_id, '-', l.Product_id)), 1, 4) AS BIGINT) AS FLOAT) / 4294967296.0 AS h_noise,
        CAST(CAST(SUBSTRING(HASHBYTES('MD5', CONCAT('rv-text-',  l.Customer_id, '-', l.Product_id)), 1, 4) AS BIGINT) AS FLOAT) / 4294967296.0 AS h_text,
        CAST(CAST(SUBSTRING(HASHBYTES('MD5', CONCAT('rv-has-',   l.Customer_id, '-', l.Product_id)), 1, 4) AS BIGINT) AS FLOAT) / 4294967296.0 AS h_has,
        CAST(CAST(SUBSTRING(HASHBYTES('MD5', CONCAT('rv-days-',  l.Customer_id, '-', l.Product_id)), 1, 4) AS BIGINT) AS FLOAT) / 4294967296.0 AS h_days,
        CAST(CAST(SUBSTRING(HASHBYTES('MD5', CONCAT('rv-time-',  l.Customer_id, '-', l.Product_id)), 1, 4) AS BIGINT) AS FLOAT) / 4294967296.0 AS h_time,
        CAST(CAST(SUBSTRING(HASHBYTES('MD5', CONCAT('rv-q-',     l.Product_id)), 1, 4) AS BIGINT) AS FLOAT) / 4294967296.0 AS h_q
    ) h;

    -- the rating of each chosen candidate
    SELECT d.*,
           CAST(CASE WHEN sc.score < 1 THEN 1 WHEN sc.score > 5 THEN 5 ELSE ROUND(sc.score, 0) END AS INT) AS Rating
    INTO   #rv_pick
    FROM   #rv_dice d
    CROSS APPLY (SELECT CASE WHEN d.Returned = 1 THEN 0.5 + d.h_noise * 3
                             WHEN d.Product_id = @problem THEN 2.5 + (d.h_noise - 0.65) * 2.4
                             ELSE 3.9 + 1.0 * d.h_q + (d.h_noise - 0.55) * 2.4 END AS score) sc
    WHERE  d.h_pick < CASE WHEN d.Returned = 1 THEN 0.7 ELSE 0.14 END;

    INSERT INTO REVIEW (Rating, Comment, Review_date, Product_id, Customer_id, Transaction_id)
    SELECT CAST(p.Rating AS TINYINT),
           CASE WHEN p.Rating >= 3 AND p.h_has < 0.2 THEN NULL
                ELSE CASE p.Rating
                  WHEN 5 THEN CHOOSE(CAST(p.h_text * 6 AS INT) + 1,
                       N'Arrived fast and exactly as described. Very happy with it.',
                       N'Great quality for the price. Would buy again.',
                       N'Perfect, no complaints at all.',
                       N'Better than I expected. Packaging was solid too.',
                       N'Works great and shipping was quick.',
                       N'Love it. Already recommended it to a friend.')
                  WHEN 4 THEN CHOOSE(CAST(p.h_text * 6 AS INT) + 1,
                       N'Good overall. Does what it should.',
                       N'Happy with it, though shipping took a little longer than I hoped.',
                       N'Solid purchase. Minor scratches on the box but the item is fine.',
                       N'Nice quality. A small thing or two could be better but I would buy again.',
                       N'Good value for the money.',
                       N'Works well. Not perfect, but close.')
                  WHEN 3 THEN CHOOSE(CAST(p.h_text * 6 AS INT) + 1,
                       N'It is fine, nothing special.',
                       N'Average. Okay for the price but I expected a bit more.',
                       N'Does the job, but the quality is not great.',
                       N'Mixed feelings. Works, but not as good as the photos suggest.',
                       N'Decent, though I have seen better for the same money.',
                       N'Okay. Arrived late but the item itself is alright.')
                  WHEN 2 THEN CHOOSE(CAST(p.h_text * 6 AS INT) + 1,
                       N'Disappointed. It is not as described.',
                       N'Quality is lower than I expected for the price.',
                       N'Had a problem with it after a few days.',
                       N'Would not buy this again.',
                       N'Packaging was crushed and the item looks used.',
                       N'Not worth the money in my opinion.')
                  ELSE CHOOSE(CAST(p.h_text * 6 AS INT) + 1,
                       N'Stopped working after a few days.',
                       N'Arrived damaged and unusable.',
                       N'Completely different from the description. Very disappointed.',
                       N'Terrible quality. Not what I paid for.',
                       N'Wrong item inside the box and support took a while to answer.',
                       N'Do not buy. It broke the first time I used it.')
                END
           END,
           CASE WHEN dt.d > @now THEN DATEADD(HOUR, -2, @now) ELSE dt.d END,
           p.Product_id, p.Customer_id, p.Transaction_id
    FROM   #rv_pick p
    CROSS APPLY (SELECT DATEADD(MINUTE, 540 + CAST(p.h_time * 720 AS INT),
                                DATEADD(DAY, 3 + CAST(p.h_days * 10 AS INT),
                                        CAST(CAST(p.Transaction_date AS DATE) AS DATETIME2))) AS d) dt;

    -- Check grid

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Reviews added', N'40 to 200', CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v BETWEEN 40 AND 200 THEN 1 ELSE 0 END
    FROM  (SELECT COUNT(*) AS v FROM REVIEW WHERE Review_id > @maxBefore) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'New reviews not linked to a completed purchase of that product by that customer', N'0', CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v = 0 THEN 1 ELSE 0 END
    FROM  (SELECT COUNT(*) AS v
           FROM   REVIEW rv
           WHERE  rv.Review_id > @maxBefore
             AND  NOT EXISTS (SELECT 1
                              FROM   SALES_TRANSACTION s
                              JOIN   TRANSACTION_ITEM ti ON ti.Transaction_id = s.Transaction_id
                              WHERE  s.Transaction_id = rv.Transaction_id AND s.Customer_id = rv.Customer_id
                                AND  s.Status = 'completed' AND ti.Product_id = rv.Product_id
                                AND  s.Marked_for_deletion = 0 AND ti.Marked_for_deletion = 0)) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Customers with two new reviews of the same product', N'0', CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v = 0 THEN 1 ELSE 0 END
    FROM  (SELECT COUNT(*) AS v
           FROM  (SELECT Customer_id, Product_id FROM REVIEW WHERE Review_id > @maxBefore
                  GROUP BY Customer_id, Product_id HAVING COUNT(*) > 1) z) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'New reviews dated in the future', N'0', CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v = 0 THEN 1 ELSE 0 END
    FROM  (SELECT COUNT(*) AS v FROM REVIEW WHERE Review_id > @maxBefore AND Review_date > @now) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'New reviews dated before the purchase', N'0', CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v = 0 THEN 1 ELSE 0 END
    FROM  (SELECT COUNT(*) AS v
           FROM   REVIEW rv JOIN SALES_TRANSACTION s ON s.Transaction_id = rv.Transaction_id
           WHERE  rv.Review_id > @maxBefore AND rv.Review_date < s.Transaction_date) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Products with at least one new review', N'at least 15', CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v >= 15 THEN 1 ELSE 0 END
    FROM  (SELECT COUNT(DISTINCT Product_id) AS v FROM REVIEW WHERE Review_id > @maxBefore) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Average rating of the new reviews', N'3.3 to 4.6', CONVERT(NVARCHAR(60), CAST(x.v AS DECIMAL(4,2))), CASE WHEN x.v BETWEEN 3.3 AND 4.6 THEN 1 ELSE 0 END
    FROM  (SELECT AVG(CAST(Rating AS FLOAT)) AS v FROM REVIEW WHERE Review_id > @maxBefore) x
    WHERE x.v IS NOT NULL;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'New reviews with 5 stars', N'at least 1', CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v >= 1 THEN 1 ELSE 0 END
    FROM  (SELECT COUNT(*) AS v FROM REVIEW WHERE Review_id > @maxBefore AND Rating = 5) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'New reviews with 1 or 2 stars', N'at least 1', CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v >= 1 THEN 1 ELSE 0 END
    FROM  (SELECT COUNT(*) AS v FROM REVIEW WHERE Review_id > @maxBefore AND Rating <= 2) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Low ratings (1 or 2 stars) without a comment', N'0', CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v = 0 THEN 1 ELSE 0 END
    FROM  (SELECT COUNT(*) AS v FROM REVIEW WHERE Review_id > @maxBefore AND Rating <= 2 AND Comment IS NULL) x;

    -- a few totals to eyeball (no pass or fail)
    INSERT INTO @r (Item, Expected, Actual, Pass)
    VALUES (N'Info: reviews per rating 1 / 2 / 3 / 4 / 5', N'-',
                (SELECT CONCAT(SUM(CASE WHEN Rating = 1 THEN 1 ELSE 0 END), N' / ', SUM(CASE WHEN Rating = 2 THEN 1 ELSE 0 END), N' / ',
                               SUM(CASE WHEN Rating = 3 THEN 1 ELSE 0 END), N' / ', SUM(CASE WHEN Rating = 4 THEN 1 ELSE 0 END), N' / ',
                               SUM(CASE WHEN Rating = 5 THEN 1 ELSE 0 END))
                 FROM REVIEW WHERE Review_id > @maxBefore), NULL),
           (N'Info: new reviews without a comment', N'-',
                (SELECT CONVERT(NVARCHAR(40), COUNT(*)) FROM REVIEW WHERE Review_id > @maxBefore AND Comment IS NULL), NULL),
           (N'Info: most returned product (SKU) and its average rating', N'-',
                (SELECT ISNULL(MAX(CONCAT(p.SKU, N' / ', CONVERT(NVARCHAR(10), CAST(a.v AS DECIMAL(3,1))))), N'none')
                 FROM PRODUCT p
                 CROSS APPLY (SELECT AVG(CAST(rv.Rating AS FLOAT)) AS v FROM REVIEW rv
                              WHERE rv.Product_id = p.Product_id AND rv.Review_id > @maxBefore) a
                 WHERE p.Product_id = @problem AND a.v IS NOT NULL), NULL),
           (N'Info: oldest and newest new review', N'-',
                (SELECT CONCAT(MIN(CAST(Review_date AS DATE)), N' to ', MAX(CAST(Review_date AS DATE)))
                 FROM REVIEW WHERE Review_id > @maxBefore), NULL);

    IF @dry = 1 ROLLBACK TRAN ELSE COMMIT TRAN;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;   -- re-raise the original error; nothing was saved
END CATCH;

SELECT CASE WHEN @dry = 1 THEN N'REHEARSAL: everything below was rolled back, nothing was saved.'
            ELSE N'Done: the demo reviews are saved.' END AS Outcome;

SELECT Item, Expected, Actual,
       CASE WHEN Pass IS NULL THEN 'info' WHEN Pass = 1 THEN 'PASS' ELSE 'FAIL' END AS Result
FROM   @r
ORDER BY Seq;
