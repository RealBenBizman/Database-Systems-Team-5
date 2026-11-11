// Pure helpers for the inventory report (no database in here, so they are easy to test).

// How late a supplier order is, against the lead time its supplier promised.
//   order = { status, promisedDays, daysTaken }
//   daysTaken = days from the order date to the received date (or to today while the order is still open)
// Returns { daysLate, open }
//   daysLate is null when there is nothing to compare (cancelled, or no promised lead time on file),
//   otherwise 0 or more.
//   open is true while the order is still Pending or Ordered, so "late" then means "overdue".
function orderTiming(order) {
  const open = order.status === 'Pending' || order.status === 'Ordered';
  const promised = order.promisedDays == null ? NaN : Number(order.promisedDays);
  const taken = order.daysTaken == null ? NaN : Number(order.daysTaken);
  if (order.status === 'Cancelled' || Number.isNaN(promised) || Number.isNaN(taken)) {
    return { daysLate: null, open };
  }
  return { daysLate: Math.max(0, taken - promised), open };
}

module.exports = { orderTiming };
