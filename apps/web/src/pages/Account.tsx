import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { formatKes, toCents } from '@empire/shared';
import { api, type User } from '../lib/api';
import { useMe } from '../lib/hooks';
import { useToast } from '../state/toast';
import { IconShield } from '../components/Icons';

export function Account() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast((s) => s.show);
  const [limit, setLimit] = useState<number>(me?.weeklyDepositLimitCents ? me.weeklyDepositLimitCents / 100 : 5000);
  const [breakDays, setBreakDays] = useState(7);

  if (!me) return null;

  async function saveLimit() {
    try {
      const { user } = await api<{ user: User }>('/account/limits', { method: 'PATCH', body: { weeklyDepositLimitCents: toCents(limit) } });
      qc.setQueryData(['me'], user);
      qc.invalidateQueries({ queryKey: ['wallet'] });
      toast('Deposit limit saved');
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  async function takeBreak() {
    if (!window.confirm(`Lock betting and deposits for ${breakDays} days? This cannot be undone early.`)) return;
    try {
      const { user } = await api<{ user: User }>('/account/self-exclude', { body: { days: breakDays } });
      qc.setQueryData(['me'], user);
      toast('Break started. Take care.', 'gold');
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  async function logout() {
    await api('/auth/logout', { body: {} });
    qc.clear();
    qc.setQueryData(['me'], null);
    nav('/');
  }

  return (
    <main className="container page" style={{ maxWidth: 880 }}>
      <h1 className="display" style={{ margin: 0, fontSize: 44 }}>ACCOUNT</h1>

      <section className="card card-pad" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <strong style={{ fontSize: 18 }}>{me.name}</strong>
          <div className="muted">{me.phone}{me.email ? ` · ${me.email}` : ''}</div>
        </div>
        <span className={`tag ${me.phoneVerified ? 'tag-ok' : 'tag-wait'}`}>Phone {me.phoneVerified ? 'verified' : 'not verified'}</span>
        <span className={`tag ${me.kycStatus === 'verified' ? 'tag-ok' : me.kycStatus === 'rejected' ? 'tag-bad' : 'tag-wait'}`}>ID {me.kycStatus}</span>
      </section>

      <section className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <IconShield style={{ color: 'var(--gold)' }} />
          <h2 style={{ margin: 0, fontSize: 18 }}>Responsible gaming</h2>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Current weekly deposit limit: <strong style={{ color: 'var(--text)' }}>{me.weeklyDepositLimitCents !== null ? formatKes(me.weeklyDepositLimitCents) : 'none'}</strong>.
          Lowering it applies straight away. Raising it needs a 24-hour cooling-off period.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: '1 1 200px' }}>
            Weekly deposit limit (KES)
            <input className="input num" type="number" min={0} value={limit || ''} onChange={(e) => setLimit(Number(e.target.value) || 0)} />
          </label>
          <button type="button" className="btn btn-gold" onClick={saveLimit}>Save limit</button>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          <label className="field" style={{ flex: '1 1 200px' }}>
            Take a break
            <select className="input" value={breakDays} onChange={(e) => setBreakDays(Number(e.target.value))}>
              {[1, 7, 30, 180, 365].map((d) => <option key={d} value={d}>{d === 1 ? '24 hours' : `${d} days`}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-ghost" onClick={takeBreak}>Start break</button>
        </div>
        {me.selfExcludedUntil && new Date(me.selfExcludedUntil) > new Date() && (
          <div className="notice notice-gold">On a break until {new Date(me.selfExcludedUntil).toDateString()}.</div>
        )}
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Need to talk to someone? [HELPLINE NUMBER]</p>
      </section>

      <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start', borderColor: '#5c1e24', color: 'var(--loss)' }} onClick={logout}>
        Log out
      </button>
    </main>
  );
}
