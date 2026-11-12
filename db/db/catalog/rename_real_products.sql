/*
   rename_real_products.sql - PHO-1: replace the fictional catalog with real products (db/catalog)

   WHAT IT DOES
     Renames the 44 products in place: it changes ONLY Name and Description. Product_id, SKU, prices,
     cost, stock, reorder threshold, condition, category, discount link, Is_active and
     Marked_for_deletion are not touched, so sales, returns, reviews, supplier orders, alerts and every
     report keep their numbers, and the SKU stays the photo file name (public/products/<SKU>.jpg).
     TR_PRODUCT_LowStock ignores updates that touch neither Stock_quantity nor Reorder_threshold, so
     nothing else fires.

   WHEN TO RUN
     On the LOCAL database (pos_store) in SSMS, signed in as an admin login. Run it as one piece after
     the "USE" batch. It stops with a message, before changing anything, if a product in the database
     has no mapping or a mapped SKU is missing. Safe to run twice (it sets the same values again).
     Do NOT run it against Azure: the hosted names are changed through the live site's manager
     Products screen (see product-photos-plan.md, step 5).

   REHEARSAL
     Leave @dry = 1 for the first run: everything is done, the check grid is printed, and ALL of it is
     rolled back. Set @dry = 0 for the real run.

   SOURCE
     The approved mapping sheet "PHO-1 product mapping (44 products)", 2026-11-11.
     seed.sql still has the fictional names (ground rule: seed.sql is not edited).
*/
USE pos_store;
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @dry BIT = 0;      -- 1 = rehearsal: rename, print the check grid, roll it all back; 0 = keep it

CREATE TABLE #rename (
    SKU            VARCHAR(50)   NOT NULL PRIMARY KEY,
    NewName        NVARCHAR(150) NOT NULL,
    NewDescription NVARCHAR(MAX) NOT NULL
);

INSERT INTO #rename (SKU, NewName, NewDescription) VALUES
    (N'ACC-MEM-1TB', N'SanDisk Extreme 1TB microSDXC Memory Card',
     N'1 TB microSD card for extra storage on Nintendo Switch and other handhelds.'),
    (N'ACC-CHRG-CBL', N'Anker Braided USB-C to USB-C Charging Cable (10 ft)',
     N'10 ft braided USB-C cable for charging controllers and handhelds.'),
    (N'ACC-STAND-VERT', N'Vertical Stand for PS5 Console (Skywin)',
     N'Space-saving vertical stand for the PS5 console.'),
    (N'ACC-CHRG-DOC', N'DualSense Charging Station for PS5',
     N'Charges two DualSense controllers at once.'),
    (N'ACC-CASE-HAND', N'HORI Hard Pouch for Nintendo Switch',
     N'Protective hard case for carrying a Nintendo Switch.'),
    (N'ACC-CTRL-BLK', N'DualSense Wireless Controller - Midnight Black',
     N'Wireless PS5 controller with haptic feedback and adaptive triggers.'),
    (N'ACC-CTRL-USED', N'DualSense Wireless Controller - Midnight Black (Used)',
     N'Used controller, cleaned and tested.'),
    (N'ACC-HEAD-PRO', N'Razer BlackShark V2 Gaming Headset',
     N'Wired gaming headset with surround sound and a detachable microphone.'),
    (N'ACC-HEAD-WL', N'PULSE 3D Wireless Headset for PS5',
     N'Wireless headset with 3D audio for PS5.'),
    (N'COLL-STAT-RARE', N'Halo 2 Master Chief 20th Anniversary Statue',
     N'Limited Master Chief statue from Dark Horse Direct and 343 Industries.'),
    (N'COLL-STAT-DRAG', N'The Elder Scrolls V: Skyrim Alduin Statue (12 in)',
     N'12-inch PVC statue of the dragon Alduin, first made for the Skyrim Collector''s Edition.'),
    (N'COLL-FIG-KNIGHT', N'Halo Infinite Master Chief with Grappleshot Statue (10 in)',
     N'10-inch Dark Horse statue with Grappleshot and Energy Sword.'),
    (N'COLL-POST-LIM', N'The Legend of Zelda: Breath of the Wild Wall Poster',
     N'Licensed wall poster.'),
    (N'COLL-FIG-MAGE', N'Skyrim Alduin (Gold) 10th Anniversary Action Figure (9 in)',
     N'McFarlane Toys limited-edition gold dragon figure with a 15 in wingspan.'),
    (N'COLL-CARD-BOX', N'Pokemon TCG Booster Display Box (36 Packs)',
     N'Sealed box of 36 Pokemon Trading Card Game booster packs.'),
    (N'COLL-CARD-BOOST', N'Pokemon TCG Booster Pack',
     N'Sealed pack of random Pokemon Trading Card Game cards.'),
    (N'CONS-ARC-1TB', N'PlayStation 5 Console (Disc Edition)',
     N'Home console with a disc drive.'),
    (N'CONS-ARC-REF', N'PlayStation 5 Console (Disc Edition) (Refurbished)',
     N'Refurbished and tested home console with a disc drive.'),
    (N'CONS-ARC-DIG', N'PlayStation 5 Digital Edition',
     N'Home console without a disc drive; games are digital only.'),
    (N'CONS-HAND-REF', N'Nintendo Switch (Refurbished)',
     N'Refurbished Nintendo Switch with a 90-day store warranty.'),
    (N'CONS-PORT-LITE', N'Nintendo Switch Lite',
     N'Compact handheld-only Nintendo Switch.'),
    (N'GIFT-100', N'Pixel Vault $100 Gift Card',
     N'Redeemable online at Pixel Vault.'),
    (N'GIFT-25', N'Pixel Vault $25 Gift Card',
     N'Redeemable online at Pixel Vault.'),
    (N'GIFT-50', N'Pixel Vault $50 Gift Card',
     N'Redeemable online at Pixel Vault.'),
    (N'MERC-HOOD-L', N'The Legend of Zelda Hyrule Crest Hoodie (L)',
     N'Pullover hoodie, size large.'),
    (N'MERC-HOOD-M', N'The Legend of Zelda Hyrule Crest Hoodie (M)',
     N'Pullover hoodie, size medium.'),
    (N'MERC-PLUSH', N'Pokemon Pikachu Plush (12 in)',
     N'Soft Pikachu plush, about 12 inches tall.'),
    (N'MERC-MUG', N'Super Mario Bros. Ceramic Mug',
     N'Licensed ceramic mug.'),
    (N'MERC-CAP', N'Pokemon Poke Ball Snapback Cap',
     N'Adjustable snapback cap.'),
    (N'MERC-MPAD', N'Razer Gigantus V2 Gaming Mouse Mat (XL)',
     N'Large soft cloth mouse mat for desk setups.'),
    (N'MERC-TSHIRT-M', N'PlayStation Shapes T-Shirt (M)',
     N'Licensed t-shirt, size medium.'),
    (N'GAME-ASTR-PS5', N'Ratchet & Clank: Rift Apart [PS5]',
     N'Sci-fi platformer adventure across dimensions.'),
    (N'GAME-DUNG-SW', N'Diablo III: Eternal Collection [Switch]',
     N'Action RPG dungeon crawler.'),
    (N'GAME-FARM-XB', N'Farming Simulator 25 [Xbox Series X]',
     N'Farming and agriculture simulation.'),
    (N'GAME-EMBR-SW', N'The Legend of Zelda: Breath of the Wild [Switch]',
     N'Open-world action-adventure.'),
    (N'GAME-LEGC-PS5', N'Uncharted: Legacy of Thieves Collection [PS5]',
     N'Two Uncharted adventures remastered for PS5.'),
    (N'GAME-HORR-XB', N'Resident Evil Village [Xbox Series X]',
     N'Survival horror adventure.'),
    (N'GAME-PUZZ-SW', N'Puyo Puyo Tetris 2 [Switch]',
     N'Puzzle game that mixes Puyo Puyo and Tetris.'),
    (N'GAME-SOCC-PS5', N'EA SPORTS FC 27 [PS5]',
     N'Football simulation game.'),
    (N'GAME-RETRO-PS4', N'Crash Bandicoot N. Sane Trilogy [PS4] (Used)',
     N'Used copy of three remastered Crash Bandicoot games.'),
    (N'GAME-KART-SWU', N'Mario Kart 8 Deluxe [Switch] (Used)',
     N'Used copy, tested.'),
    (N'GAME-STAR-PS5', N'Ghost of Tsushima Director''s Cut [PS5]',
     N'Open-world samurai action-adventure.'),
    (N'GAME-RACE-XB', N'Forza Horizon 5 [Xbox Series X]',
     N'Open-world racing game.'),
    (N'GAME-RACE-XBU', N'Forza Horizon 5 [Xbox Series X] (Used)',
     N'Used copy, tested.');

DECLARE @mapped   INT = (SELECT COUNT(*) FROM #rename);
DECLARE @found    INT = (SELECT COUNT(*) FROM PRODUCT p JOIN #rename r ON r.SKU = p.SKU WHERE p.Marked_for_deletion = 0);
DECLARE @unmapped INT = (SELECT COUNT(*) FROM PRODUCT p
                         WHERE p.Marked_for_deletion = 0 AND NOT EXISTS (SELECT 1 FROM #rename r WHERE r.SKU = p.SKU));

-- Stop before changing anything if the database and the mapping do not match.
IF @found <> @mapped OR @unmapped > 0
BEGIN
    SELECT N'STOPPED: nothing was changed.' AS Result,
           @mapped AS Mapped_SKUs, @found AS Found_in_PRODUCT, @unmapped AS Products_without_mapping;
    SELECT N'Mapped but not in PRODUCT' AS Problem, r.SKU
    FROM   #rename r
    WHERE  NOT EXISTS (SELECT 1 FROM PRODUCT p WHERE p.SKU = r.SKU AND p.Marked_for_deletion = 0)
    UNION ALL
    SELECT N'In PRODUCT but not mapped', p.SKU
    FROM   PRODUCT p
    WHERE  p.Marked_for_deletion = 0 AND NOT EXISTS (SELECT 1 FROM #rename r WHERE r.SKU = p.SKU);
    DROP TABLE #rename;
    RETURN;
END;

-- Fingerprint of every column that must NOT change.
DECLARE @before INT = (SELECT CHECKSUM_AGG(CHECKSUM(Product_id, SKU, Cost_price, Sell_price, Stock_quantity,
                              Reorder_threshold, Product_condition, Category_id, Discount_id, Is_active,
                              Marked_for_deletion))
                       FROM PRODUCT);

DECLARE @checks TABLE (Seq INT IDENTITY(1,1), Check_name NVARCHAR(80), Result VARCHAR(4));
DECLARE @updated INT, @after INT;

BEGIN TRAN;

UPDATE p
SET    p.Name = r.NewName,
       p.Description = r.NewDescription
FROM   PRODUCT p
JOIN   #rename r ON r.SKU = p.SKU;
SET @updated = @@ROWCOUNT;

SET @after = (SELECT CHECKSUM_AGG(CHECKSUM(Product_id, SKU, Cost_price, Sell_price, Stock_quantity,
                       Reorder_threshold, Product_condition, Category_id, Discount_id, Is_active,
                       Marked_for_deletion))
              FROM PRODUCT);

INSERT INTO @checks (Check_name, Result) VALUES
 (N'all mapped SKUs found, none left unmapped',
    CASE WHEN @found = @mapped AND @unmapped = 0 THEN 'PASS' ELSE 'FAIL' END),
 (N'rows updated = rows in the mapping',
    CASE WHEN @updated = @mapped THEN 'PASS' ELSE 'FAIL' END),
 (N'every other column is unchanged',
    CASE WHEN @before = @after THEN 'PASS' ELSE 'FAIL' END),
 (N'every product has its new Name and Description',
    CASE WHEN (SELECT COUNT(*) FROM PRODUCT p JOIN #rename r ON r.SKU = p.SKU
               WHERE p.Name = r.NewName AND p.Description = r.NewDescription) = @mapped THEN 'PASS' ELSE 'FAIL' END),
 (N'no two products share a Name',
    CASE WHEN (SELECT COUNT(*) FROM (SELECT Name FROM PRODUCT WHERE Marked_for_deletion = 0
                                     GROUP BY Name HAVING COUNT(*) > 1) d) = 0 THEN 'PASS' ELSE 'FAIL' END),
 (N'(Used) / (Refurbished) in the Name matches Product_condition',
    CASE WHEN (SELECT COUNT(*) FROM PRODUCT
               WHERE Marked_for_deletion = 0
                 AND (   (Product_condition = 'Used'        AND Name NOT LIKE N'%(Used)')
                      OR (Product_condition = 'Refurbished' AND Name NOT LIKE N'%(Refurbished)')
                      OR (Product_condition = 'New'         AND (Name LIKE N'%(Used)' OR Name LIKE N'%(Refurbished)'))
                     )) = 0 THEN 'PASS' ELSE 'FAIL' END),
 (N'no old fictional name left in any Name',
    CASE WHEN (SELECT COUNT(*) FROM PRODUCT
               WHERE Marked_for_deletion = 0
                 AND (   Name LIKE N'%Starfall%'   OR Name LIKE N'%Ember%'       OR Name LIKE N'%Arcadia%'
                      OR Name LIKE N'%Pixel Heart%' OR Name LIKE N'%Turbo Circuit%' OR Name LIKE N'%Pocket%'
                      OR Name LIKE N'%Legacy Quest%' OR Name LIKE N'%Retro Arcade%' OR Name LIKE N'%Astral Frontier%'
                      OR Name LIKE N'%Drifters%' OR Name LIKE N'%Harvest Valley%' OR Name LIKE N'%Midnight Manor%'
                      OR Name LIKE N'%Pro League%' OR Name LIKE N'%Rocket Kart%' OR Name LIKE N'%Dragonwing%')
              ) = 0 THEN 'PASS' ELSE 'FAIL' END);

IF @dry = 1 OR EXISTS (SELECT 1 FROM @checks WHERE Result = 'FAIL') ROLLBACK TRAN ELSE COMMIT TRAN;

SELECT CASE
         WHEN EXISTS (SELECT 1 FROM @checks WHERE Result = 'FAIL')
              THEN N'A CHECK FAILED: everything was rolled back, nothing was saved.'
         WHEN @dry = 1
              THEN N'REHEARSAL: all checks passed; everything was rolled back, nothing was saved. Set @dry = 0 for the real run.'
         ELSE N'DONE: ' + CAST(@updated AS NVARCHAR(10)) + N' products renamed and saved.'
       END AS Outcome;

SELECT Seq, Check_name, Result FROM @checks ORDER BY Seq;

DROP TABLE #rename;
