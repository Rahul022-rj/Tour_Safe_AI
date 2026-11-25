// Profile & settings: identity (read-only), contact details, emergency contact, notification preferences,
// change password, log out everywhere. Shared by tourists and operators (operators see the relevant parts).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../../api';
import { useAuth } from '../../AuthContext';
import { Card, ErrorBox, Field, PageHeader, useAsync, useConfirm, useToast } from '../../components/ui';
import { formatDate, isEmail, isPhone, passwordProblems } from '../../utils';

function ContactForm() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const tourist = user.role === 'tourist';
  const [f, setF] = useState({
    phone: user.phone || '',
    nationality: user.nationality || '',
    ecName: user.emergencyContact?.name || '',
    ecPhone: user.emergencyContact?.phone || '',
    ecEmail: user.emergencyContact?.email || '',
    ecRelation: user.emergencyContact?.relation || '',
    email: user.notificationPrefs?.email !== false,
    sms: user.notificationPrefs?.sms !== false,
    notifyEc: user.notificationPrefs?.notifyEmergencyContact !== false,
  });
  const [errors, setErrors] = useState({});
  const { busy, error, run } = useAsync();
  const set = (e) => setF({ ...f, [e.target.name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault();
    const errs = {};
    if (f.phone && !isPhone(f.phone)) errs.phone = 'Enter a valid phone number';
    if (tourist) {
      if (f.ecName.trim().length < 2) errs.ecName = 'Required';
      if (!isPhone(f.ecPhone)) errs.ecPhone = 'Enter a valid phone number';
      if (f.ecEmail && !isEmail(f.ecEmail)) errs.ecEmail = 'Enter a valid email';
      if (!f.nationality.trim()) errs.nationality = 'Required';
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const body = { phone: f.phone };
    if (tourist) {
      Object.assign(body, {
        nationality: f.nationality,
        emergencyContact: { name: f.ecName, phone: f.ecPhone, email: f.ecEmail, relation: f.ecRelation },
        notificationPrefs: { email: f.email, sms: f.sms, notifyEmergencyContact: f.notifyEc },
      });
    }
    try {
      const data = await run(() => api('/auth/me', { method: 'PATCH', body }));
      setUser(data.user);
      toast('Profile saved', { tone: 'success' });
    } catch (err) {
      setErrors({ ...err.errors, ecName: err.errors?.['emergencyContact.name'], ecPhone: err.errors?.['emergencyContact.phone'], ecEmail: err.errors?.['emergencyContact.email'] });
    }
  }

  return (
    <Card title="Contact details">
      <form onSubmit={save} noValidate>
        <div className="grid-2">
          <Field label="Phone" error={errors.phone}><input name="phone" type="tel" value={f.phone} onChange={set} /></Field>
          {tourist && <Field label="Nationality" error={errors.nationality}><input name="nationality" value={f.nationality} onChange={set} /></Field>}
        </div>
        {tourist && (
          <>
            <h4>Emergency contact</h4>
            <div className="grid-2">
              <Field label="Name" error={errors.ecName}><input name="ecName" value={f.ecName} onChange={set} /></Field>
              <Field label="Phone" error={errors.ecPhone}><input name="ecPhone" type="tel" value={f.ecPhone} onChange={set} /></Field>
              <Field label="Email (optional)" error={errors.ecEmail}><input name="ecEmail" type="email" value={f.ecEmail} onChange={set} /></Field>
              <Field label="Relation"><input name="ecRelation" value={f.ecRelation} onChange={set} /></Field>
            </div>
            <h4>Notifications</h4>
            <label className="check"><input type="checkbox" name="email" checked={f.email} onChange={set} /> Email me about zone alerts and incident updates</label>
            <label className="check"><input type="checkbox" name="sms" checked={f.sms} onChange={set} /> SMS me about restricted zones and help assignment</label>
            <label className="check"><input type="checkbox" name="notifyEc" checked={f.notifyEc} onChange={set} /> Notify my emergency contact when I press SOS or enter a restricted zone</label>
          </>
        )}
        <ErrorBox error={error} />
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
      </form>
    </Card>
  );
}

function PasswordForm() {
  const toast = useToast();
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const { busy, error, run } = useAsync();
  const problems = passwordProblems(f.newPassword);
  const set = (e) => setF({ ...f, [e.target.name]: e.target.value });
  async function save(e) {
    e.preventDefault();
    try {
      const data = await run(() => api('/auth/change-password', { method: 'POST', body: f }));
      setToken(data.token); // the old token was invalidated; keep this tab logged in
      setF({ currentPassword: '', newPassword: '', confirmPassword: '' });
      toast(data.message, { tone: 'success' });
    } catch {
      /* shown */
    }
  }
  return (
    <Card title="Change password">
      <form onSubmit={save} noValidate>
        <Field label="Current password"><input name="currentPassword" type="password" autoComplete="current-password" value={f.currentPassword} onChange={set} /></Field>
        <Field label="New password" error={f.newPassword && problems.length ? `Needs ${problems.join(', ')}` : ''}><input name="newPassword" type="password" autoComplete="new-password" value={f.newPassword} onChange={set} /></Field>
        <Field label="Confirm new password" error={f.confirmPassword && f.confirmPassword !== f.newPassword ? 'Does not match' : ''}><input name="confirmPassword" type="password" autoComplete="new-password" value={f.confirmPassword} onChange={set} /></Field>
        <ErrorBox error={error} />
        <button className="btn btn-primary" disabled={busy || !f.currentPassword || problems.length > 0 || f.newPassword !== f.confirmPassword}>{busy ? 'Saving…' : 'Change password'}</button>
      </form>
    </Card>
  );
}

export default function Profile() {
  const { user, logout } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  async function logoutEverywhere() {
    if (!(await confirm({ title: 'Log out on all devices?', message: 'Every browser where you are logged in will be signed out.', confirmText: 'Log out everywhere', tone: 'danger' }))) return;
    await logout({ everywhere: true });
    navigate('/login');
  }
  return (
    <div className="page">
      <PageHeader title="Profile & settings" />
      <div className="grid-2">
        <Card title="Account">
          <dl className="kv">
            <dt>Name</dt><dd>{user.name}</dd>
            <dt>Email</dt><dd>{user.email}</dd>
            <dt>Role</dt><dd>{user.role === 'admin' ? 'Operator' : 'Tourist'}</dd>
            {user.role === 'tourist' && <><dt>Trip</dt><dd>{formatDate(user.tripStart)} – {formatDate(user.tripEnd)}</dd>
              <dt>ID document</dt><dd>{user.govtIdType} ••••{String(user.govtId || '').slice(-3)}</dd></>}
          </dl>
          {user.role === 'tourist' && <p className="muted small">Name, email, ID document and trip dates are part of your Digital ID fingerprint and cannot be edited. Contact the help desk to change them.</p>}
          <button className="btn btn-ghost btn-small" onClick={logoutEverywhere}>Log out on all devices</button>
        </Card>
        <PasswordForm />
        <ContactForm />
      </div>
    </div>
  );
}
