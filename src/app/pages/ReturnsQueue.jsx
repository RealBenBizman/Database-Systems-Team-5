
import { useEffect, useState } from 'react';

export default function ReturnsQueue() {
  const [returns, setReturns] = useState([]);
  const [returnId, setReturnId] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function loadReturns() {
    try {
      const response = await fetch('/api/returns', {
        credentials: 'same-origin'
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load returns');
      }

      setReturns(data.returns);
    } catch (error) {
      setMessage(error.message);
    }
  }

  useEffect(() => {
    loadReturns();
  }, []);

  async function handleAction(action) {
    if (!returnId) {
      setMessage('Please enter a Return ID.');
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to ${action} return #${returnId}?`
    );

    if (!confirmed) return;

    setLoading(true);
    setMessage('');

    try {
      const response = await fetch('/api/returns', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          returnId: Number(returnId),
          action
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Action failed');
      }

      setMessage(data.message);
      await loadReturns();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>Returns Management</h1>
      <p>Review and process customer return requests.</p>

      <section>
        <h2>Process Return</h2>

        <label htmlFor="return-id">Return ID</label>
        <input
          id="return-id"
          type="number"
          min="1"
          placeholder="Enter Return ID"
          value={returnId}
          onChange={(e) => setReturnId(e.target.value)}
        />

        <div>
          <button
            disabled={loading}
            onClick={() => handleAction('approve')}
          >
            Approve
          </button>

          <button
            disabled={loading}
            onClick={() => handleAction('deny')}
          >
            Deny
          </button>

          <button
            disabled={loading}
            onClick={() => handleAction('refund')}
          >
            Refund
          </button>
        </div>

        <p role="status">{message}</p>
      </section>

      <section>
        <h2>Return Requests</h2>

        <button onClick={loadReturns}>
          Refresh Returns
        </button>

        <table>
          <thead>
            <tr>
              <th>Return ID</th>
              <th>Transaction ID</th>
              <th>Reason</th>
              <th>Status</th>
              <th>Refund Total</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {returns.map((item) => (
              <tr key={item.Return_id}>
                <td>{item.Return_id}</td>
                <td>{item.Transaction_id}</td>
                <td>{item.Reason}</td>
                <td>{item.Status}</td>
                <td>${Number(item.Refund_total ?? 0).toFixed(2)}</td>
                <td>
                  <button
                    onClick={() => setReturnId(String(item.Return_id))}
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
