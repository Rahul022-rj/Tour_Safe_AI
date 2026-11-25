// Tourist registration with client-side validation (the server re-validates everything)
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { useAuth, homeFor } from '../../AuthContext';
import { ErrorBox, Field, useToast } from '../../components/ui';
import { isEmail, isPhone, passwordProblems } from '../../utils';

const emptyForm = {
  name: '', email: '', password: '', confirmPassword: '', phone: '', nationality: '', govtIdType: 'passport', govtId: '',
  tripStart: '', tripEnd: '', ecName: '', ecPhone: '', ecEmail: '', ecRelation: '', consent: false,
};

const today = () => new Date().toISOString().slice(0, 10);

export function validate(f) {
  const e = {};
  if (f.name.trim().length < 2) e.name = 'Full name is required';
  if (!isEmail(f.email)) e.email = 'Enter a valid email address';
  const pw = passwordProblems(f.password);
  if (pw.length) e.password = `Needs ${pw.join(', ')}`;
  if (f.confirmPassword !== f.password) e.confirmPassword = 'Passwords do not match';
  if (!isPhone(f.phone)) e.phone = 'Enter a valid phone number, e.g. +91 98765 43210';
  if (!f.nationality.trim()) e.nationality = 'Nationality is required';
  if (!/^[A-Za-z0-9\- ]{4,40}$/.test(f.govtId.trim())) e.govtId = '4-40 letters, digits or dashes';
  if (!f.tripStart) e.tripStart = 'Choose the first day of your trip';
  if (!f.tripEnd) e.tripEnd = 'Choose the last day of your trip';
  else if (f.tripStart && f.tripEnd < f.tripStart) e.tripEnd = 'Trip end must be on or after the start';
  else if (f.tripEnd < today()) e.tripEnd = 'Trip end cannot be in the past';
  if (f.ecName.trim().length < 2) e.ecName = 'Emergency contact name is required';
  if (!isPhone(f.ecPhone)) e.ecPhone = 'Enter a valid phone number';
  if (f.ecEmail && !isEmail(f.ecEmail)) e.ecEmail = 'Enter a valid email';
  if (!f.consent) e.consent = 'Please confirm to continue';
  return e;
}

// Map server field names to form field names
const SERVER_FIELDS = { 'emergencyContact.name': 'ecName', 'emergencyContact.phone': 'ecPhone', 'emergencyContact.email': 'ecEmail' };

// Puts the cursor on the first field with an error (important on phones, where the error may be off-screen)
function focusFirstError() {
  setTimeout(() => {
    const el = document.querySelector('.register-card [aria-invalid="true"], .register-card .field-invalid input');
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.focus({ preventScroll: true });
    }
  }, 0);
}

export default function Register() {
  const { user, saveSession } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homeFor(user)} replace />;

  const update = (e) => {
    const { name, value, type, checked } = e.target;
    const next = { ...form, [name]: type === 'checkbox' ? checked : value };
    setForm(next);
    if (touched) setErrors(validate(next));
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setTouched(true);
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length) {
      focusFirstError();
      return;
    }
    setServerError(null);
    setBusy(true);
    try {
      const data = await api('/auth/register', {
        method: 'POST',
        body: {
          name: form.name,
          email: form.email,
          password: form.password,
          confirmPassword: form.confirmPassword,
          phone: form.phone,
          govtIdType: form.govtIdType,
          govtId: form.govtId,
          nationality: form.nationality,
          // The trip runs from the start of the first day to the end of the last day (local time)
          tripStart: new Date(`${form.tripStart}T00:00:00`).toISOString(),
          tripEnd: new Date(`${form.tripEnd}T23:59:59`).toISOString(),
          emergencyContact: { name: form.ecName, phone: form.ecPhone, email: form.ecEmail || undefined, relation: form.ecRelation },
        },
      });
      saveSession(data);
      toast(data.digitalId?.message || 'Registration complete', { tone: 'success', title: 'Welcome to TourSafe' });
      navigate('/tourist', { replace: true });
    } catch (err) {
      const mapped = Object.fromEntries(Object.entries(err.errors || {}).map(([k, v]) => [SERVER_FIELDS[k] || k, v]));
      setErrors(mapped);
      setServerError(err);
      focusFirstError();
    } finally {
      setBusy(false);
    }
  }

  const f = (name, label, props = {}, hint) => (
    <Field label={label} error={errors[name]} hint={hint}>
      <input name={name} value={form[name]} onChange={update} aria-invalid={Boolean(errors[name])} {...props} />
    </Field>
  );

  return (
    <div className="card register-card">
      <h1>Tourist registration</h1>
      <p className="muted">Your details stay in the TourSafe database. Only a salted fingerprint (hash) of your identity is written to the blockchain.</p>
      <form onSubmit={handleSubmit} noValidate>
        <h2 className="form-section">Account</h2>
        <div className="grid-2">
          {f('name', 'Full name (as in your ID)', { autoComplete: 'name', required: true })}
          {f('email', 'Email', { type: 'email', autoComplete: 'email', required: true })}
          {f('password', 'Password', { type: 'password', autoComplete: 'new-password', required: true }, '8+ characters with upper & lower case, a digit and a symbol')}
          {f('confirmPassword', 'Confirm password', { type: 'password', autoComplete: 'new-password', required: true })}
          {f('phone', 'Mobile phone', { type: 'tel', autoComplete: 'tel', placeholder: '+91 98765 43210', required: true })}
          {f('nationality', 'Nationality', { autoComplete: 'country-name', required: true })}
        </div>

        <h2 className="form-section">Identity &amp; trip</h2>
        <div className="grid-2">
          <Field label="ID document type" error={errors.govtIdType}>
            <select name="govtIdType" value={form.govtIdType} onChange={update}>
              <option value="passport">Passport</option>
              <option value="aadhaar">Aadhaar</option>
              <option value="national_id">National ID card</option>
              <option value="driving_licence">Driving licence</option>
              <option value="other">Other</option>
            </select>
          </Field>
          {f('govtId', 'ID document number', { required: true, autoComplete: 'off' })}
          {f('tripStart', 'Trip start', { type: 'date', required: true })}
          {f('tripEnd', 'Trip end', { type: 'date', min: form.tripStart || today(), required: true })}
        </div>

        <h2 className="form-section">Emergency contact</h2>
        <div className="grid-2">
          {f('ecName', 'Name', { required: true })}
          {f('ecPhone', 'Phone', { type: 'tel', required: true })}
          {f('ecEmail', 'Email (optional, for alerts)', { type: 'email' })}
          {f('ecRelation', 'Relation (optional)', { placeholder: 'e.g. Mother' })}
        </div>

        <label className={`check ${errors.consent ? 'field-invalid' : ''}`}>
          <input type="checkbox" name="consent" checked={form.consent} onChange={update} />
          <span>I agree that my location is shared with the control room while I switch location sharing on, and that my emergency contact may be notified if I press SOS.</span>
        </label>
        {errors.consent && <small className="field-error">{errors.consent}</small>}

        <ErrorBox error={serverError} />
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Registering…' : 'Create account & Digital ID'}</button>
      </form>
      <p className="small">Already registered? <Link to="/login">Log in</Link></p>
    </div>
  );
}
