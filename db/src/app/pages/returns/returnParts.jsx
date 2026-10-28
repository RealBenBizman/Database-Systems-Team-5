// Small pieces shared by the returns screens.
import { date, money } from '../storefront/components.jsx';

export const STATUS_LABELS = { requested: 'Waiting for review', approved: 'Approved', denied: 'Denied', refunded: 'Refunded' };

export function StatusTag({ status }) {
  return <span className={`tag rt-tag-${status}`}>{STATUS_LABELS[status] || status}</span>;
}

// What a status means for the customer.
export function statusText(r) {
  if (r.status === 'requested') return 'We are reviewing your request.';
  if (r.status === 'approved') return 'Approved. Your refund will be issued soon.';
  if (r.status === 'denied') return 'This return was not approved.';
  return `Refunded on ${date(r.refundedAt)}. The items went back into stock and the points you earned on them were taken back.`;
}

// Items of one return as a small table: product, quantity, refund.
export function ReturnItems({ items }) {
  return <div className="table-wrap rt-items">
    <table className="table">
      <thead><tr><th scope="col">Product</th><th scope="col" className="num">Qty</th><th scope="col" className="num">Refund</th></tr></thead>
      <tbody>
        {items.map((item) => <tr key={item.productId}>
          <td>{item.name}</td><td className="num">{item.quantity}</td><td className="num">{money(item.refundAmount)}</td>
        </tr>)}
      </tbody>
    </table>
  </div>;
}

export { date, money };
