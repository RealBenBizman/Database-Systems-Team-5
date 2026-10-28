
import { useEffect, useState } from 'react';

export default function SaleEvents() {
  const [saleEventId, setSaleEventId] = useState('');
  const [eventName, setEventName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const [events, setEvents] = useState([]);

async function loadEvents() {
  try {
    const response = await fetch('/api/sale-events', {
      credentials: 'same-origin'
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to load events');
    }

    setEvents(data.events ?? []);
  } catch (error) {
    setMessage(error.message);
  }
}

useEffect(() => {
  loadEvents();
}, []);

  async function handleAction(action) {
    setMessage('');

    if (action !== 'create' && !saleEventId.trim()) {
      setMessage('Please enter a Sale Event ID.');
      return;
    }

    if (action !== 'deactivate') {
      if (!eventName.trim() || !startDate || !endDate) {
        setMessage('Event name and both dates are required.');
        return;
      }

      if (startDate > endDate) {
        setMessage('Start date cannot be after end date.');
        return;
      }
    }

    if (action === 'deactivate') {
      const confirmed = window.confirm(
        `Deactivate sale event #${saleEventId}?`
      );
      if (!confirmed) return;
    }

    const method =
      action === 'create' ? 'POST' :
      action === 'update' ? 'PATCH' : 'DELETE';

    const body = action === 'deactivate'
      ? { saleEventId: Number(saleEventId) }
      : {
          ...(action === 'update'
            ? { saleEventId: Number(saleEventId) }
            : {}),
          eventName: eventName.trim(),
          description,
          startDate,
          endDate
        };

    setLoading(true);

    try {
      const response = await fetch('/api/sale-events', {
        method,
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Sale event action failed.');
      }

      setMessage(data.message || 'Operation successful.');
      await loadEvents();

      if (action === 'create') {
        setEventName('');
        setDescription('');
        setStartDate('');
        setEndDate('');
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>Sale Events Management</h1>
      <p>Create, update, and deactivate promotional events.</p>

      <section>
        <h2>Sale Event Details</h2>

        <div>
          <label htmlFor="sale-event-id">Sale Event ID (for updates)</label>
          <input
            id="sale-event-id"
            type="number"
            min="1"
            value={saleEventId}
            onChange={(e) => setSaleEventId(e.target.value)}
            placeholder="Enter existing Event ID"
          />
        </div>

        <div>
          <label htmlFor="event-name">Event Name</label>
          <input
            id="event-name"
            value={eventName}
            maxLength={100}
            onChange={(e) => setEventName(e.target.value)}
            placeholder="Example: Holiday Sale"
          />
        </div>

        <div>
          <label htmlFor="description">Description</label>
          <textarea
            id="description"
            value={description}
            maxLength={500}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the promotion"
          />
        </div>

        <div>
          <label htmlFor="start-date">Start Date</label>
          <input
            id="start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="end-date">End Date</label>
          <input
            id="end-date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>

        <div>
          <button
            disabled={loading}
            onClick={() => handleAction('create')}
          >
            Create Event
          </button>

          <button
            disabled={loading}
            onClick={() => handleAction('update')}
          >
            Update Event
          </button>

          <button
            disabled={loading}
            onClick={() => handleAction('deactivate')}
          >
            Deactivate Event
          </button>
        </div>

        <p role="status">{message}</p>
      </section>
      <section>
  <h2>Existing Sale Events</h2>

  <button onClick={loadEvents}>
    Refresh Events
  </button>

  <table>
    <thead>
      <tr>
        <th>Event ID</th>
        <th>Event Name</th>
        <th>Description</th>
        <th>Start Date</th>
        <th>End Date</th>
        <th>Action</th>
      </tr>
    </thead>

    <tbody>
      {events.map((event) => (
        <tr key={event.Sale_event_id}>
          <td>{event.Sale_event_id}</td>
          <td>{event.Event_name}</td>
          <td>{event.Description}</td>
          <td>{event.Start_date?.slice(0, 10)}</td>
          <td>{event.End_date?.slice(0, 10)}</td>
          <td>
            <button onClick={() => {
              setSaleEventId(String(event.Sale_event_id));
              setEventName(event.Event_name ?? '');
              setDescription(event.Description ?? '');
              setStartDate(event.Start_date?.slice(0, 10) ?? '');
              setEndDate(event.End_date?.slice(0, 10) ?? '');
            }}>
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
