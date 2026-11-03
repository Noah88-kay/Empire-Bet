import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { registerSchema } from '@empire/shared';
import { api, type User } from '../lib/api';
import { useMe } from '../lib/hooks';
import { IconCheck } from '../components/Icons';

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth">
      <section className="auth-aside">
        <span />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <h1>YOUR SEAT AT<br />THE <span style={{ color: 'var(--gold)' }}>TABLE.</span></h1>
          <p className="muted" style={{ fontSize: 16, maxWidth: 440, margin: 0 }}>
            Sports, live betting and casino in one wallet. Instant M-Pesa deposits and withdrawals, no hidden fees.
          </p>
          <div className="ticks">
            {['Withdraw straight to M-Pesa, free of charge', 'Odds on every major league', 'Deposit limits and breaks built in'].map((t) => (
              <div key={t}><IconCheck style={{ color: 'var(--win)' }} />{t}</div>
            ))}
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>18+ only. Licensed by BCLB, licence no. [BCLB LICENCE NO.].</p>
      </section>
      <section className="auth-main">{children}</section>
    </main>
  );
}

export function Login() {
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api<{ user: User }>('/auth/login', { body: { phone, password } });
      qc.setQueryData(['me'], user);
      nav((loc.state as { from?: string } | null)?.from ?? '/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <form className="auth-form" onSubmit={submit}>
        <h2>Log in</h2>
        <label className="field">
          Phone number
          <input className="input" type="tel" autoComplete="tel" placeholder="07XX XXX XXX" required value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="field">
          Password
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn-gold btn-lg" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        <p className="muted" style={{ textAlign: 'center', margin: 0 }}>
          New here? <Link to="/register">Create an account</Link>
        </p>
      </form>
    </AuthShell>
  );
}

export function Register() {
  const { data: me, isLoading } = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: '', phone: '', email: '', password: '', dateOfBirth: '', nationalId: '', acceptTerms: false });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);

  if (isLoading) return null;
  if (me?.phoneVerified) return <Navigate to="/" replace />;
  const step = me ? 2 : 1;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function submitDetails(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = registerSchema.safeParse(form);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check your details');
    setBusy(true);
    try {
      const { user } = await api<{ user: User }>('/auth/register', { body: form });
      qc.setQueryData(['me'], user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { user } = await api<{ user: User }>('/auth/verify-phone', { body: { code } });
      qc.setQueryData(['me'], user);
      nav('/wallet');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      const r = await api<{ ok: true; user?: User }>('/auth/resend-otp', { body: {} });
      if (r.user) return qc.setQueryData(['me'], r.user); // server verified the phone directly (no SMS provider)
      setResent(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <AuthShell>
      {step === 1 ? (
        <form className="auth-form" onSubmit={submitDetails} noValidate>
          <div className="steps" aria-label="Step 1 of 2"><span className="on" /><span /></div>
          <div>
            <span className="eyebrow">Step 1 of 2</span>
            <h2>Create your account</h2>
          </div>
          <label className="field">Full name<input className="input" autoComplete="name" value={form.name} onChange={set('name')} /></label>
          <label className="field">M-Pesa phone number<input className="input" type="tel" autoComplete="tel" placeholder="07XX XXX XXX" value={form.phone} onChange={set('phone')} /></label>
          <label className="field">Email (optional)<input className="input" type="email" autoComplete="email" value={form.email} onChange={set('email')} /></label>
          <label className="field">Password<input className="input" type="password" autoComplete="new-password" placeholder="At least 8 characters" value={form.password} onChange={set('password')} /></label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <label className="field">National ID number<input className="input" inputMode="numeric" value={form.nationalId} onChange={set('nationalId')} /></label>
            <label className="field">Date of birth<input className="input" type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} /></label>
          </div>
          <label className="check">
            <input type="checkbox" checked={form.acceptTerms} onChange={set('acceptTerms')} />
            <span>I am 18 or older and accept the <a href="#">Terms</a> and <a href="#">Privacy Policy</a>.</span>
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn-gold btn-lg" disabled={busy}>{busy ? 'Creating account…' : 'Continue'}</button>
          <p className="muted" style={{ textAlign: 'center', margin: 0 }}>Already have an account? <Link to="/login">Log in</Link></p>
        </form>
      ) : (
        <form className="auth-form" onSubmit={submitCode}>
          <div className="steps" aria-label="Step 2 of 2"><span className="on" /><span className="on" /></div>
          <div>
            <span className="eyebrow">Step 2 of 2</span>
            <h2>Verify your phone</h2>
            <p className="muted" style={{ margin: '8px 0 0' }}>
              We sent a 6-digit code by SMS to <strong style={{ color: 'var(--text)' }}>{me?.phone}</strong>.
            </p>
          </div>
          <label className="field">
            SMS code
            <input
              className="input input-lg num"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="••••••"
              style={{ letterSpacing: 10, textAlign: 'center' }}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn-gold btn-lg" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify & continue'}</button>
          <button type="button" className="btn btn-ghost" onClick={resend} disabled={resent}>
            {resent ? 'New code sent' : 'Send a new code'}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
