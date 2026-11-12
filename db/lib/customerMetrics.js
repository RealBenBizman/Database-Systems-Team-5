const cents = (n) => Math.round((Number(n) || 0) * 100);

function customerType(c) {
  if (c.orders > 0) return c.ordersBefore > 0 ? 'Returning' : 'New';
  return c.ordersBefore > 0 ? 'Did not return' : 'No orders yet';
}

function rewardStatus(reward, today) {
  if (reward.usedOn) return 'Used';
  return reward.expires < today ? 'Expired' : 'Available';
}

function numberOrders(orders, customers) {
  const count = {};
  customers.forEach((c) => { count[c.customerId] = Number(c.ordersBefore) || 0; });
  return orders.map((o) => {
    count[o.customerId] = (count[o.customerId] || 0) + 1;
    return { ...o, orderNo: count[o.customerId] };
  });
}

function addUp(orders) {
  const by = {};
  orders.forEach((o) => {
    if (!by[o.customerId]) by[o.customerId] = { orders: 0, units: 0, cents: 0, last: null };
    const t = by[o.customerId];
    t.orders += 1;
    t.units += Number(o.units) || 0;
    t.cents += cents(o.total);
    if (!t.last || o.saleDate > t.last) t.last = o.saleDate;
  });
  return by;
}

function topCategory(categories) {
  const best = {};
  categories.forEach((r) => {
    const top = best[r.customerId];
    if (!top || cents(r.revenue) > cents(top.revenue)) best[r.customerId] = r;
  });
  return best;
}

function rollUp(customers, orders, previousOrders, categories) {
  const now = addUp(orders);
  const before = previousOrders ? addUp(previousOrders) : null;
  const best = topCategory(categories);
  return customers.map((c) => {
    const t = now[c.customerId] || { orders: 0, units: 0, cents: 0, last: null };
    const p = before ? before[c.customerId] || { orders: 0, cents: 0 } : null;
    const row = {
      ...c,
      ordersBefore: Number(c.ordersBefore) || 0,
      orders: t.orders,
      units: t.units,
      spent: t.cents / 100,
      lastOrder: t.last || c.lastBefore || null,
      prevOrders: p ? p.orders : null,
      prevSpent: p ? p.cents / 100 : null,
      favorite: best[c.customerId] ? best[c.customerId].category : null,
    };
    return { ...row, type: customerType(row) };
  });
}

module.exports = { customerType, rewardStatus, numberOrders, rollUp };
