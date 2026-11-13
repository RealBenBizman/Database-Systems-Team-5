/*
   Small helpers shared by the manager screens that add, edit and remove things.

     const { data, error, reload } = useLoad('/api/manager/suppliers');   // data is null while loading

     <RemoveCard
       title="Remove Acme"
       label="Remove Acme Games?"
       message="Its past orders stay."
       url={'/api/manager/supplier-directory?id=' + id}
       done="Removed Acme Games."
       onRemoved={(text) => { say(text); reload(); }}
       onCancel={() => setPanel(null)} />

   The server decides whether a removal is allowed. When it says no (409) its message
   is shown inside the card, so the manager learns what to fix first.
*/
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Card, ConfirmRemove, ErrorBanner } from './ui.jsx';

// Loads a list from the API. reload() fetches it again.
export function useLoad(url) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    api.get(url)
      .then((d) => { if (current) { setData(d); setError(''); } })
      .catch((e) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [url, version]);
  return { data, error, reload: () => setVersion((v) => v + 1) };
}

// Runs a save and reports the result: save(() => api.post(...), 'Saved.') calls onDone('Saved.') on success.
export function useSave(onDone) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function save(action, message) {
    setError('');
    setSaving(true);
    try {
      await action();
      onDone(message);
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  }
  return { error, saving, save };
}

// A card with the confirm step and the DELETE call.
export function RemoveCard({ title, label, message, url, done, onRemoved, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    setError('');
    setBusy(true);
    try {
      await api.delete(url);
      onRemoved(done);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Card reveal title={title}>
      <ErrorBanner>{error}</ErrorBanner>
      <ConfirmRemove label={label} message={message} busy={busy} onConfirm={remove} onCancel={onCancel} />
    </Card>
  );
}
