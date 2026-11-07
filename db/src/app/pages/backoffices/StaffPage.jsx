// Staff (managers): see the employees, add one, change a role, remove someone who left.
// Remove flags the account (nothing is deleted): the person can no longer sign in, and what they handled keeps their name.
// The server refuses removing yourself, the last manager, or someone who still supervises other employees.
import { useState } from 'react';
import { api } from '../../../shared/api.js';
import { useAuth } from '../../../shared/auth.jsx';
import { RemoveCard, useLoad, useSave } from '../../../shared/manage.jsx';
import { Banner, Button, Card, ErrorBanner, Field, PageHeader, Spinner, Table } from '../../../shared/ui.jsx';

const ROLES = ['Manager', 'Support'];

function AddForm({ employees, onDone, onCancel }) {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', role: 'Support', hireDate: '', supervisorId: '', password: '' });
  const { error, saving, save } = useSave(onDone);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  return (
    <Card title="Add an employee">
      <form onSubmit={(e) => { e.preventDefault(); save(() => api.post('/api/manager/employees', form), 'Employee added. Give them the temporary password.'); }}>
        <ErrorBanner>{error}</ErrorBanner>
        <Field label="First name" value={form.firstName} onChange={set('firstName')} maxLength={50} required />
        <Field label="Last name" value={form.lastName} onChange={set('lastName')} maxLength={50} required />
        <Field label="Email" type="email" value={form.email} onChange={set('email')} maxLength={100} required hint="They sign in with this email." />
        <Field label="Phone number" type="tel" value={form.phone} onChange={set('phone')} maxLength={20} required hint="10 digits." />
        <Field label="Role" as="select" value={form.role} onChange={set('role')}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </Field>
        <Field label="Hire date" type="date" value={form.hireDate} onChange={set('hireDate')} hint="Leave empty for today." />
        <Field label="Supervisor" as="select" value={form.supervisorId} onChange={set('supervisorId')}>
          <option value="">None</option>
          {employees.map((e) => <option key={e.employeeId} value={e.employeeId}>{e.firstName} {e.lastName}</option>)}
        </Field>
        <Field label="Temporary password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required
          hint="At least 8 characters with a letter and a number. Tell the person to use it to sign in." />
        <div className="row">
          <Button type="submit" loading={saving}>Add employee</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

function RoleForm({ employee, onDone, onCancel }) {
  const [role, setRole] = useState(employee.role);
  const { error, saving, save } = useSave(onDone);
  return (
    <Card title={'Change the role of ' + employee.firstName + ' ' + employee.lastName}>
      <form onSubmit={(e) => { e.preventDefault(); save(() => api.put('/api/manager/employees', { employeeId: employee.employeeId, role }), 'Role changed.'); }}>
        <ErrorBanner>{error}</ErrorBanner>
        <Field label="Role" as="select" value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </Field>
        <div className="row">
          <Button type="submit" loading={saving}>Save</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

export default function StaffPage() {
  const { user } = useAuth();
  const { data, error, reload } = useLoad('/api/manager/employees');
  const [panel, setPanel] = useState(null);   // { kind: 'add' | 'role' | 'remove', item }
  const [notice, setNotice] = useState('');
  const close = () => setPanel(null);
  const done = (m) => { setNotice(m); close(); reload(); };
  if (error && !data) return <><PageHeader title="Staff" /><ErrorBanner>{error}</ErrorBanner></>;
  if (!data) return <><PageHeader title="Staff" /><Spinner /></>;
  const isMe = (e) => user && Number(user.id) === e.employeeId;
  return (
    <>
      <PageHeader title="Staff" subtitle="Add employees, change roles, and remove people who left." />
      {notice && <Banner kind="success">{notice}</Banner>}
      <Banner kind="info">
        A removed employee can no longer sign in, but the orders, returns and stock changes they handled keep their name.
        You cannot change or remove your own account, the last manager, or someone who still supervises other employees.
      </Banner>
      <p><Button type="button" onClick={() => { setNotice(''); setPanel({ kind: 'add' }); }}>Add employee</Button></p>
      {panel && panel.kind === 'add' && <div style={{ marginBottom: 16 }}><AddForm employees={data.employees} onCancel={close} onDone={done} /></div>}
      {panel && panel.kind === 'role' && <div style={{ marginBottom: 16 }}><RoleForm key={panel.item.employeeId} employee={panel.item} onCancel={close} onDone={done} /></div>}
      {panel && panel.kind === 'remove' && (
        <div style={{ marginBottom: 16 }}>
          <RemoveCard
            key={panel.item.employeeId}
            title={'Remove ' + panel.item.firstName + ' ' + panel.item.lastName}
            label={'Remove ' + panel.item.firstName + ' ' + panel.item.lastName + ' from the staff?'}
            message="They will not be able to sign in again. Their email address cannot be used for a new employee."
            url={'/api/manager/employees?id=' + panel.item.employeeId}
            done={'Removed ' + panel.item.firstName + ' ' + panel.item.lastName + '.'}
            onRemoved={done}
            onCancel={close} />
        </div>
      )}
      <Table
        columns={[
          { key: 'name', label: 'Name', render: (e) => e.firstName + ' ' + e.lastName + (isMe(e) ? ' (you)' : '') },
          { key: 'email', label: 'Email' },
          { key: 'role', label: 'Role' },
          { key: 'hireDate', label: 'Hired' },
          { key: 'supervisorName', label: 'Supervisor', render: (e) => e.supervisorName || '' },
          {
            key: 'actions', label: '',
            render: (e) => (isMe(e) ? '' : (
              <div className="row">
                <Button type="button" variant="secondary" onClick={() => { setNotice(''); setPanel({ kind: 'role', item: e }); }}>Change role</Button>
                <Button type="button" variant="secondary" onClick={() => { setNotice(''); setPanel({ kind: 'remove', item: e }); }}>Remove</Button>
              </div>
            )),
          },
        ]}
        rows={data.employees} rowKey="employeeId" empty="No employees."
      />
    </>
  );
}
