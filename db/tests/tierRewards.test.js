// Tier reward tests (cart side). The database is faked, so these run without SQL Server.
// They check that the cart asks for the customer's reward and applies the $500 cap the same way
// sp_Checkout does. The rules inside the database are tested by db/loyalty/test.sql.
jest.mock('../lib/db', () => {
  const sql = jest.requireActual('mssql');
  return { sql, query: jest.fn(), withTransaction: jest.fn() };
});

const db = require('../lib/db');
const { readCart, applyRewardCap, REWARD_CAP, PRODUCT_JOINS } = require('../lib/storefront');

const result = (rows = []) => ({ recordset: rows, recordsets: [rows] });

// One cart row as SQL returns it for a line that won the tier reward (15% of the line).
const rewardRow = (id, baseTotal, quantity = 1, extra = {}) => {
  const saving = Math.round(baseTotal * 15) / 100;
  return {
    id, name: `Product ${id}`, quantity, baseTotal, price: baseTotal / quantity,
    discountAmount: saving, lineTotal: baseTotal - saving, effectivePrice: (baseTotal - saving) / quantity,
    discountId: 1000900, discountName: 'Tier reward: Gold', isReward: true, ...extra,
  };
};
const plainRow = (id, baseTotal, extra = {}) => ({
  id, name: `Product ${id}`, quantity: 1, baseTotal, price: baseTotal, discountAmount: 0, lineTotal: baseTotal,
  effectivePrice: baseTotal, discountId: null, discountName: null, isReward: false, ...extra,
});
const withTotals = (rows) => {
  const subtotal = rows.reduce((sum, row) => sum + row.lineTotal, 0);
  return rows.map((row) => ({ ...row, cartSubtotal: subtotal, cartQuantity: rows.length }));
};

describe('PRODUCT_JOINS', () => {
  test('the catalog and product pages never see a tier reward', () => {
    expect(PRODUCT_JOINS()).not.toContain('VW_TIER_REWARD');
    expect(PRODUCT_JOINS('v.Quantity')).not.toContain('VW_TIER_REWARD');
  });

  test('the cart adds the customer\'s reward as a third discount candidate', () => {
    const sql = PRODUCT_JOINS('v.Quantity', 'v.Customer_id');
    expect(sql).toContain('VW_TIER_REWARD');
    expect(sql).toContain('rw.Customer_id = v.Customer_id');
    expect(sql).toContain('d.Discount_id = reward.Discount_id');
  });
});

describe('applyRewardCap', () => {
  test('the cap is $500', () => {
    expect(REWARD_CAP).toBe(500);
  });

  test('leaves lines alone when the reward saves less than the cap', () => {
    const rows = withTotals([rewardRow(1, 100), plainRow(2, 40)]);
    const copy = JSON.parse(JSON.stringify(rows));
    applyRewardCap(rows);
    expect(rows).toEqual(copy);
  });

  test('takes the cap line by line in product order', () => {
    // raw savings: 450 + 300; the first line keeps 450, the second only the 50 that is left
    const rows = withTotals([rewardRow(2, 2000), rewardRow(1, 3000)]);
    applyRewardCap(rows);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId[1].discountAmount).toBe(450);
    expect(byId[1].lineTotal).toBe(2550);
    expect(byId[2].discountAmount).toBe(50);
    expect(byId[2].lineTotal).toBe(1950);
    expect(byId[2].effectivePrice).toBe(1950);
    expect(rows[0].discountAmount + rows[1].discountAmount).toBe(500);
  });

  test('the cart subtotal follows the capped lines', () => {
    const rows = withTotals([rewardRow(1, 4000)]); // raw saving 600
    applyRewardCap(rows);
    expect(rows[0].discountAmount).toBe(500);
    expect(rows[0].lineTotal).toBe(3500);
    expect(rows[0].cartSubtotal).toBe(3500);
  });

  test('a line left with no saving loses the reward label', () => {
    const rows = withTotals([rewardRow(1, 4000), rewardRow(2, 200)]); // 600 then 30
    applyRewardCap(rows);
    const second = rows.find((row) => row.id === 2);
    expect(second.discountAmount).toBe(0);
    expect(second.lineTotal).toBe(200);
    expect(second.discountId).toBeNull();
    expect(second.discountName).toBeNull();
    expect(second.isReward).toBe(false);
  });

  test('lines that did not win the reward are not counted against the cap', () => {
    const other = plainRow(1, 4000, { discountAmount: 1000, lineTotal: 3000, discountId: 1000500, discountName: 'Sale' });
    const rows = withTotals([other, rewardRow(2, 3000)]); // reward saving 450 is under the cap
    const copy = JSON.parse(JSON.stringify(rows));
    applyRewardCap(rows);
    expect(rows).toEqual(copy);
  });

  test('handles an empty cart', () => {
    expect(applyRewardCap([])).toEqual([]);
  });
});

describe('readCart with a tier reward', () => {
  test('asks the database for the customer\'s reward and returns the discounted cart', async () => {
    db.query.mockReset();
    db.query.mockResolvedValue(result(withTotals([rewardRow(1, 100)])));
    const cart = await readCart(1000001);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('VW_TIER_REWARD');
    expect(sql).toContain('AS isReward');
    expect(params).toEqual({ customerId: 1000001 });
    expect(cart.subtotal).toBe(85);
    expect(cart.items[0]).toMatchObject({ id: 1, discountAmount: 15, lineTotal: 85, discountName: 'Tier reward: Gold' });
  });

  test('applies the $500 cap to the rows it gets back', async () => {
    db.query.mockReset();
    db.query.mockResolvedValue(result(withTotals([rewardRow(1, 5000)]))); // raw saving 750
    const cart = await readCart(1000001);
    expect(cart.items[0].discountAmount).toBe(500);
    expect(cart.subtotal).toBe(4500);
  });

  test('a cart with no reward is returned as it came', async () => {
    db.query.mockReset();
    db.query.mockResolvedValue(result(withTotals([plainRow(1, 20), plainRow(2, 30)])));
    const cart = await readCart(1000001);
    expect(cart.subtotal).toBe(50);
    expect(cart.itemCount).toBe(2);
  });
});