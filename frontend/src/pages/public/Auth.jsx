// Login, forgot password and reset password
import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth, homeFor } from '../../AuthContext';
import { ErrorBox, Field, useAsync } from '../../components/ui';
import { isEmail, passwordProblems } from '../../utils';

export function Login() {
  const { user, saveSession, notice } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState({});
  const { busy, error, run } = useAsync();

  if (user) return <Navigate to={homeFor(user)} replace />; // already logged in

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = {};
    if (!isEmail(email)) errs.email = 'Enter a valid email address';
    if (!password) errs.password = 'Enter your password';
    setFieldError(errs);
    if (Object.keys(errs).length) return;
    try {
      const data = await run(() => api('/auth/login', { method: 'POST', body: { email, password } }));
      saveSession(data);
      const from = location.state?.from;
      const allowed = from && from.startsWith(homeFor(data.user)); // only go back to a page of the right role
      navigate(allowed ? from : homeFor(data.user), { replace: true });
    } catch {
      /* shown by ErrorBox */
    }
  }

  return (
    <div className="auth-card card">
      <h1>Log in</h1>
      {notice && <p className="notice notice-warning">{notice}</p>}
      <form onSubmit={handleSubmit} noValidate>
        <Field label="Email" error={fieldError.email}>
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" error={fieldError.password}>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorBox error={error} />
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
      <p className="row-between small">
        <Link to="/forgot-password">Forgot password?</Link>
        <span>New tourist? <Link to="/register">Register</Link></span>
      </p>
    </div>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState('');
  const { busy, error, run } = useAsync();
  async function submit(e) {
    e.preventDefault();
    try {
      const data = await run(() => api('/auth/forgot-password', { method: 'POST', body: { email } }));
      setDone(data.message);
    } catch {
      /* shown */
    }
  }
  return (
    <div className="auth-card card">
      <h1>Forgot password</h1>
      {done ? (
        <>
          <p className="notice notice-success">{done}</p>
          <p className="muted small">The link is valid for 30 minutes and works once. If no email arrives, the operator may not have configured an email provider; contact the help desk.</p>
          <Link to="/login">Back to log in</Link>
        </>
      ) : (
        <form onSubmit={submit}>
          <p className="muted">Enter your account email. We will send you a link to choose a new password.</p>
          <Field label="Email"><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <ErrorBox error={error} />
          <button className="btn btn-primary btn-block" disabled={busy || !isEmail(email)}>{busy ? 'Sending…' : 'Send reset link'}</button>
        </form>
      )}
    </div>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState('');
  const { busy, error, run } = useAsync();
  const token = params.get('token') || '';
  const email = params.get('email') || '';
  const problems = passwordProblems(pw);

  async function submit(e) {
    e.preventDefault();
    try {
      const data = await run(() => api('/auth/reset-password', { method: 'POST', body: { email, token, newPassword: pw, confirmPassword: confirm } }));
      setDone(data.message);
      setTimeout(() => navigate('/login'), 2500);
    } catch {
      /* shown */
    }
  }

  if (!token || !email) return <div className="auth-card card"><h1>Reset password</h1><p className="notice notice-danger">This reset link is incomplete. Request a new one.</p><Link to="/forgot-password">Request a new link</Link></div>;
  return (
    <div className="auth-card card">
      <h1>Choose a new password</h1>
      {done ? (
        <p className="notice notice-success">{done}</p>
      ) : (
        <form onSubmit={submit}>
          <p className="muted small">For {email}</p>
          <Field label="New password" error={pw && problems.length ? `Needs ${problems.join(', ')}` : ''}>
            <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
          </Field>
          <Field label="Confirm new password" error={confirm && confirm !== pw ? 'Passwords do not match' : ''}>
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
          <ErrorBox error={error} />
          <button className="btn btn-primary btn-block" disabled={busy || problems.length > 0 || pw !== confirm}>{busy ? 'Saving…' : 'Set new password'}</button>
        </form>
      )}
    </div>
  );
}
