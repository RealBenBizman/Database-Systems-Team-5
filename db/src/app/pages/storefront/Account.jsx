import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../shared/api.js';
import { useAuth } from '../../../shared/auth.jsx';
import { Banner, Button, Card, EmptyState, ErrorBanner, Field, PageHeader, Spinner } from '../../../shared/ui.jsx';
import { date, useLoad } from './components.jsx';
import './Storefront.css';

const SECTIONS = ['Profile', 'Addresses', 'Phone numbers', 'Preferences'];

export default function Account() {
  const { user, refreshUser } = useAuth();
  const resource = useLoad(() => api.get('/api/account'), [user?.id]);
  const [section, setSection] = useState('Profile');
  const [profile, setProfile] = useState(null);
  const [address, setAddress] = useState(null);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(null);
  const [removing, setRemoving] = useState(null);
  useEffect(() => { if (resource.data && !profile) setProfile(resource.data.profile); }, [resource.data]);

  async function action(key, message, operation) {
    setBusy(key); setError(null); setNotice('');
    try { await operation(); setNotice(message); resource.reload(); }
    catch (err) { setError(err); }
    finally { setBusy(''); }
  }

  function newAddress() {
    setAddress({ type: 'home', recipient: `${profile.firstName} ${profile.lastName}`, street: '', apt: '', city: '', state: '', zip: '', isDefault: resource.data.addresses.length === 0 });
    setRemoving(null); setError(null); setNotice('');
  }

  function editAddress(item) { setAddress({ ...item, apt: item.apt || '' }); setRemoving(null); setError(null); setNotice(''); }

  function saveAddress(event) {
    event.preventDefault();
    action('address', 'Address saved.', async () => {
      await (address.id ? api.patch : api.post)('/api/account/addresses', address);
      setAddress(null);
    });
  }

  if (resource.loading && !resource.data) return <Spinner label="Loading account..." />;
  if (resource.error && !resource.data) return <><ErrorBanner error={resource.error} /><Button variant="secondary" onClick={resource.reload}>Try again</Button></>;
  if (!profile) return <Spinner />;
  const data = resource.data;
  const changeProfile = (name) => (event) => setProfile({ ...profile, [name]: event.target.value });
  const changeAddress = (name) => (event) => setAddress({ ...address, [name]: event.target.value });

  return <div className="sf-page">
    <PageHeader title="My account" subtitle={`Member since ${date(data.profile.createdDate)}`} />
    <div className="sf-account-links"><Link to="/orders">My orders</Link><Link to="/returns">My returns</Link><Link to="/rewards">Rewards: {data.profile.points} points{data.profile.tier ? ` · ${data.profile.tier}` : ''}</Link><Link to="/notifications">Notifications</Link></div>
    <ErrorBanner error={error || resource.error} />{notice && <Banner kind="success">{notice}</Banner>}
    <div className="sf-account-layout">
      <nav className="sf-account-nav" aria-label="Account sections">{SECTIONS.map((name) => <button key={name} type="button" aria-pressed={section === name} onClick={() => { setSection(name); setError(null); setNotice(''); }} disabled={!!busy}>{name}</button>)}</nav>
      <div>
        {section === 'Profile' && <Card title="Profile"><form onSubmit={(event) => {
          event.preventDefault();
          action('profile', 'Profile saved.', async () => {
            await api.patch('/api/account', { firstName: profile.firstName, lastName: profile.lastName, email: profile.email });
            await refreshUser();
          });
        }}>
          <div className="sf-form-grid"><Field label="First name" required maxLength={50} autoComplete="given-name" value={profile.firstName} onChange={changeProfile('firstName')} /><Field label="Last name" required maxLength={50} autoComplete="family-name" value={profile.lastName} onChange={changeProfile('lastName')} /></div>
          <Field label="Email" type="email" required maxLength={100} autoComplete="email" value={profile.email} onChange={changeProfile('email')} />
          <Button type="submit" loading={busy === 'profile'} disabled={!!busy}>Save profile</Button>
        </form></Card>}
        {section === 'Addresses' && <div className="stack">
          <div className="sf-section-top"><h2>Delivery addresses</h2><Button onClick={newAddress} disabled={!!busy}>Add address</Button></div>
          {address && <Card title={address.id ? 'Edit address' : 'New address'}><form onSubmit={saveAddress}>
            <Field label="Address label" as="select" value={address.type} onChange={changeAddress('type')}><option value="home">Home</option><option value="work">Work</option><option value="other">Other</option>{!['home', 'work', 'other'].includes(address.type) && <option value={address.type}>{address.type}</option>}</Field>
            <Field label="Recipient" required maxLength={100} autoComplete="shipping name" value={address.recipient} onChange={changeAddress('recipient')} />
            <Field label="Street address" required maxLength={100} autoComplete="shipping address-line1" value={address.street} onChange={changeAddress('street')} />
            <Field label="Apartment or suite (optional)" maxLength={10} autoComplete="shipping address-line2" value={address.apt} onChange={changeAddress('apt')} />
            <div className="sf-form-grid"><Field label="City" required maxLength={50} autoComplete="shipping address-level2" value={address.city} onChange={changeAddress('city')} /><Field label="State" required minLength={2} maxLength={2} placeholder="TX" autoComplete="shipping address-level1" value={address.state} onChange={changeAddress('state')} /></div>
            <Field label="ZIP code" required pattern="[0-9]{5}(-?[0-9]{4})?" maxLength={10} autoComplete="shipping postal-code" value={address.zip} onChange={changeAddress('zip')} />
            <label className="sf-check"><input type="checkbox" checked={!!address.isDefault} onChange={(event) => setAddress({ ...address, isDefault: event.target.checked })} /> Make this my default address</label>
            <div className="row"><Button type="submit" loading={busy === 'address'} disabled={!!busy}>Save address</Button><Button type="button" variant="secondary" disabled={!!busy} onClick={() => setAddress(null)}>Cancel</Button></div>
          </form></Card>}
          {!data.addresses.length && !address && <EmptyState title="No saved addresses">Add a delivery address to make checkout easier.</EmptyState>}
          {data.addresses.map((item) => <Card key={item.id}><div className="sf-section-top"><h3>{item.type}</h3>{item.isDefault && <span className="tag">Default</span>}</div>
            <address className="sf-address">{item.recipient}<br />{item.street}{item.apt && <>, {item.apt}</>}<br />{item.city}, {item.state} {item.zip}</address>
            <div className="row"><Button variant="secondary" disabled={!!busy} onClick={() => editAddress(item)}>Edit</Button>
              {!item.isDefault && <Button variant="secondary" disabled={!!busy} loading={busy === `default-${item.id}`} onClick={() => action(`default-${item.id}`, 'Default address updated.', () => api.patch('/api/account/addresses', { ...item, isDefault: true }))}>Make default</Button>}
              <button className="sf-text-button" type="button" disabled={!!busy} onClick={() => setRemoving(item.id)}>Remove</button></div>
            {removing === item.id && <div className="sf-confirm" role="group" aria-label="Confirm address removal"><p>Remove this address?</p><div className="row"><Button variant="danger" loading={busy === `remove-${item.id}`} disabled={!!busy} onClick={() => action(`remove-${item.id}`, 'Address removed.', async () => { await api.delete(`/api/account/addresses?id=${item.id}`); setRemoving(null); if (address?.id === item.id) setAddress(null); })}>Confirm removal</Button><Button variant="secondary" disabled={!!busy} onClick={() => setRemoving(null)}>Cancel</Button></div></div>}
          </Card>)}
        </div>}
        {section === 'Phone numbers' && <Card title="Phone numbers">
          {data.phones.length ? <ul className="sf-phone-list">{data.phones.map((item) => <li key={item.phone}><span>{item.phone}</span><Button variant="secondary" disabled={!!busy} onClick={() => action(`phone-${item.phone}`, 'Phone number removed.', () => api.delete(`/api/account/phones?phone=${encodeURIComponent(item.phone)}`))}>Remove</Button></li>)}</ul> : <p className="sf-muted">No phone numbers saved.</p>}
          <form onSubmit={(event) => { event.preventDefault(); action('phone', 'Phone number added.', async () => { await api.post('/api/account/phones', { phone }); setPhone(''); }); }}>
            <Field label="New phone number" type="tel" autoComplete="tel" required maxLength={30} value={phone} onChange={(event) => setPhone(event.target.value)} hint="Include a country code if needed." />
            <Button type="submit" loading={busy === 'phone'} disabled={!!busy}>Add phone number</Button>
          </form>
        </Card>}
        {section === 'Preferences' && <Card title="Notification preferences"><form onSubmit={(event) => { event.preventDefault(); action('preferences', 'Notification preferences saved.', () => api.patch('/api/account', { notifyCart: !!profile.notifyCart, notifyOffers: !!profile.notifyOffers })); }}>
          <p className="sf-muted">Choose which updates appear in your account. These are in-site notifications.</p>
          <label className="sf-check"><input type="checkbox" checked={!!profile.notifyCart} onChange={(event) => setProfile({ ...profile, notifyCart: event.target.checked })} /> Remind me about items left in my cart</label>
          <label className="sf-check"><input type="checkbox" checked={!!profile.notifyOffers} onChange={(event) => setProfile({ ...profile, notifyOffers: event.target.checked })} /> Let me know about offers</label>
          <Button type="submit" loading={busy === 'preferences'} disabled={!!busy}>Save preferences</Button>
        </form></Card>}
      </div>
    </div>
  </div>;
}
