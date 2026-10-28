
import { useEffect, useState } from 'react';

export default function Discounts() {
  const [discounts, setDiscounts] = useState([]);
  const [discountId, setDiscountId] = useState('');
  const [discountName, setDiscountName] = useState('');
  const [discountType, setDiscountType] = useState('percent');
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('');
  const [amountType, setAmountType] = useState('percent');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [saleEventId, setSaleEventId] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function loadDiscounts() {
    try {
      const response = await fetch('/api/discounts', {
        credentials: 'same-origin'
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load discounts.');
      }

      setDiscounts(data.discounts ?? []);
    } catch (error) {
      setMessage(error.message);
    }
  }

  useEffect(() => {
    loadDiscounts();
  }, []);

  async function handleAction(action) {
    setMessage('');

    if (action !== 'create' && !discountId.trim()) {
      setMessage('Please select or enter a Discount ID.');
      return;
    }

    if (action !== 'deactivate') {
      if (!discountName.trim() || !amount || !startDate || !endDate) {
        setMessage('Name, amount, and both dates are required.');
        return;
      }

      if (Number(amount) <= 0 ||
          (amountType === 'percent' && Number(amount) > 100)) {
        setMessage('Please enter a valid discount amount.');
        return;
      }

      if (startDate > endDate) {
        setMessage('Start date cannot be after end date.');
        return;
      }
    }

    if (action === 'deactivate') {
      if (!window.confirm(`Deactivate discount #${discountId}?`)) {
        return;
      }
    }

    const method =
      action === 'create' ? 'POST' :
      action === 'update' ? 'PATCH' : 'DELETE';

    const body = action === 'deactivate'
      ? { discountId: Number(discountId) }
      : {
          ...(action === 'update'
            ? { discountId: Number(discountId) }
            : {}),
          discountName: discountName.trim(),
          discountType,
          code: code.trim() || null,
          amount: Number(amount),
          amountType,
          startDate,
          endDate,
          saleEventId: saleEventId
            ? Number(saleEventId)
            : null
        };

    setLoading(true);

    try {
      const response = await fetch('/api/discounts', {
        method,
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Discount action failed.');
      }

      setMessage(data.message || 'Operation successful.');
      await loadDiscounts();

      if (action === 'create') {
        setDiscountName('');
        setCode('');
        setAmount('');
        setStartDate('');
        setEndDate('');
        setSaleEventId('');
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  function selectDiscount(discount) {
    setDiscountId(String(discount.Discount_id));
    setDiscountName(discount.Discount_name ?? '');
    setDiscountType(discount.Discount_type ?? 'percent');
    setCode(discount.Code ?? '');
    setAmount(String(discount.Amount ?? ''));
    setAmountType(discount.Amount_type ?? 'percent');
    setStartDate(discount.Start_date?.slice(0, 10) ?? '');
    setEndDate(discount.End_date?.slice(0, 10) ?? '');
    setSaleEventId(
      discount.Sale_event_id == null
        ? ''
        : String(discount.Sale_event_id)
    );
  }

  return (
    <main>
      <h1>Discounts Management</h1>
      <p>Create, update, and deactivate discounts.</p>

      <section>
        <h2>Discount Details</h2>

        <div>
          <label>Discount ID (for updates)</label>
          <input
            type="number"
            min="1"
            value={discountId}
            onChange={(e) => setDiscountId(e.target.value)}
          />
        </div>

        <div>
          <label>Discount Name</label>
          <input
            value={discountName}
            onChange={(e) => setDiscountName(e.target.value)}
            placeholder="Halloween Discount"
          />
        </div>

        <div>
          <label>Discount Type</label>
          <select
            value={discountType}
            onChange={(e) => setDiscountType(e.target.value)}
          >
            <option value="percent">Percent</option>
            <option value="fixed">Fixed</option>
          </select>
        </div>

        <div>
          <label>Discount Code</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="HALLOWEEN20"
          />
        </div>

        <div>
          <label>Amount</label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div>
          <label>Amount Type</label>
          <select
            value={amountType}
            onChange={(e) => setAmountType(e.target.value)}
          >
            <option value="percent">Percent (%)</option>
            <option value="fixed">Fixed ($)</option>
          </select>
        </div>

        <div>
          <label>Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>

        <div>
          <label>End Date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>

        <div>
          <label>Sale Event ID (optional)</label>
          <input
            type="number"
            min="1"
            value={saleEventId}
            onChange={(e) => setSaleEventId(e.target.value)}
            placeholder="Link to a sale event"
          />
        </div>

        <div>
          <button
            disabled={loading}
            onClick={() => handleAction('create')}
          >
            Create Discount
          </button>

          <button
            disabled={loading}
            onClick={() => handleAction('update')}
          >
            Update Discount
          </button>

          <button
            disabled={loading}
            onClick={() => handleAction('deactivate')}
          >
            Deactivate Discount
          </button>
        </div>

        <p role="status">{message}</p>
      </section>

      <section>
        <h2>Existing Discounts</h2>

        <button onClick={loadDiscounts}>
          Refresh Discounts
        </button>

        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Code</th>
              <th>Amount</th>
              <th>Start</th>
              <th>End</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {discounts.map((discount) => (
              <tr key={discount.Discount_id}>
                <td>{discount.Discount_id}</td>
                <td>{discount.Discount_name}</td>
                <td>{discount.Code}</td>
                <td>
                  {discount.Amount_type === 'percent'
                    ? `${discount.Amount}%`
                    : `$${discount.Amount}`}
                </td>
                <td>{discount.Start_date?.slice(0, 10)}</td>
                <td>{discount.End_date?.slice(0, 10)}</td>
                <td>
                  <button
                    onClick={() => selectDiscount(discount)}
                  >
                    Select
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
