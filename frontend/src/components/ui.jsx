// Reusable UI building blocks: toasts, confirm dialog, loading / empty / error states, badges, stat cards, fields.
import { Children, cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';

// ---------------- Toasts ----------------
const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (message, { tone = 'info', title, duration = 6000 } = {}) => {
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((list) => [{ id, message, tone, title }, ...list].slice(0, 5));
      if (duration) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss]
  );
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toasts" role="region" aria-live="polite" aria-label="Notifications">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === 'danger' ? 'alert' : 'status'}>
            <div>
              {t.title && <b>{t.title}</b>}
              <div>{t.message}</div>
            </div>
            <button className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

// ---------------- Confirm dialog ----------------
const ConfirmContext = createContext(async () => false);

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const resolver = useRef(null);
  const confirm = useCallback((opts) => new Promise((resolve) => {
    resolver.current = resolve;
    setDialog({ confirmText: 'Confirm', cancelText: 'Cancel', tone: 'primary', input: null, ...opts, value: '' });
  }), []);
  const close = (result) => {
    resolver.current?.(result);
    setDialog(null);
  };
  useEffect(() => {
    if (!dialog) return undefined;
    const onKey = (e) => e.key === 'Escape' && close(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog]);
  const inputInvalid = dialog?.input?.required && dialog.value.trim().length < (dialog.input.minLength || 1);
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && (
        <div className="modal-backdrop" onClick={() => close(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="confirm-title">{dialog.title}</h3>
            {dialog.message && <p>{dialog.message}</p>}
            {dialog.input && (
              <label className="field">
                <span>{dialog.input.label}</span>
                <input autoFocus value={dialog.value} placeholder={dialog.input.placeholder} maxLength={300} onChange={(e) => setDialog({ ...dialog, value: e.target.value })} />
              </label>
            )}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => close(false)}>{dialog.cancelText}</button>
              <button
                className={`btn btn-${dialog.tone}`}
                autoFocus={!dialog.input}
                disabled={inputInvalid}
                onClick={() => close(dialog.input ? dialog.value.trim() : true)}
              >
                {dialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmContext);

// ---------------- States ----------------
export const Spinner = ({ label = 'Loading…' }) => (
  <div className="state" role="status"><span className="spinner" aria-hidden="true" /> {label}</div>
);
export const EmptyState = ({ title, children, icon = '○' }) => (
  <div className="state empty"><div className="state-icon" aria-hidden="true">{icon}</div><b>{title}</b>{children && <div className="muted">{children}</div>}</div>
);
export const ErrorBox = ({ error, onRetry }) =>
  error ? (
    <div className="error-box" role="alert">
      <span>{typeof error === 'string' ? error : error.message}</span>
      {onRetry && <button className="btn btn-small btn-ghost" onClick={onRetry}>Retry</button>}
    </div>
  ) : null;

export const Badge = ({ tone = 'muted', children, title }) => <span className={`badge badge-${tone}`} title={title}>{children}</span>;

export const StatCard = ({ label, value, tone = 'default', hint, to }) => {
  const body = (
    <>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value ?? '–'}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </>
  );
  return to ? <a className={`stat stat-${tone}`} href={to}>{body}</a> : <div className={`stat stat-${tone}`}>{body}</div>;
};

export function Card({ title, actions, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h3>{title}</h3>}
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

// Labelled input with an error message underneath. The error is linked with aria-describedby (not put inside
// the <label>) so screen readers announce "Email" as the name and the error as its description.
export function Field({ label, error, hint, children, className = '' }) {
  const id = useId();
  const msgId = `${id}-msg`;
  const child = Children.only(children);
  const control = isValidElement(child)
    ? cloneElement(child, { id: child.props.id || id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error || hint ? msgId : undefined })
    : child;
  return (
    <div className={`field ${error ? 'field-invalid' : ''} ${className}`}>
      <label htmlFor={child.props?.id || id}>{label}</label>
      {control}
      {error ? <small id={msgId} className="field-error">{error}</small> : hint ? <small id={msgId} className="muted">{hint}</small> : null}
    </div>
  );
}

// Small hook: run an async action with busy + error state
export function useAsync() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async (fn) => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

// Loads data from an async function; reload() re-runs it
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    return fnRef.current()
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => setState((s) => ({ ...s, error, loading: false })));
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, deps);
  return { ...state, reload, setData: (data) => setState((s) => ({ ...s, data: typeof data === 'function' ? data(s.data) : data })) };
}
