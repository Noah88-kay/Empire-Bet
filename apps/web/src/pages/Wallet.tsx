import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { depositSchema, formatKes, toCents, withdrawSchema } from '@empire/shared';
import { api, type LedgerDto, type PaymentDto } from '../lib/api';
import { useMe, useWallet } from '../lib/hooks';
import { IconCheck, IconPhone } from '../components/Icons';

const KIND_LABEL: Record<string, string> = {
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  withdrawal_refund: 'Withdrawal refund',
  bet_stake: 'Bet',
  bet_win: 'Bet win',
  bet_void: 'Bet void',
  game_stake: 'Casino stake',
  game_win: 'Casino win',
  adjustment: 'Adjustment'
};

export function Wallet() {
  const { data: me } = useMe();
  const { data: wallet } = useWallet(!!me);
  const qc = useQueryClient();
  const [tab, setTab] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState(500);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PaymentDto | null>(null);

  const tx = useQuery({ queryKey: ['transactions'], queryFn: () => api<{ entries: LedgerDto[]; payments: PaymentDto[] }>('/wallet/transactions') });

  // Poll the payment we just started until M-Pesa confirms it.
  const status = useQuery({
    queryKey: ['payment', pending?.id],
    queryFn: () => api<{ payment: PaymentDto }>(`/wallet/payments/${pending!.id}`),
    enabled: !!pending && ['initiated', 'processing'].includes(pending.status),
    refetchInterval: 2000
  });
  useEffect(() => {
    const p = status.data?.payment;
    if (p && p.status !== pending?.status) {
      setPending(p);
      qc.invalidateQueries({ queryKey: ['wallet'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    }
  }, [status.data, pending?.status, qc]);

  const submit = useMutation({
    mutationFn: () => api<{ payment: PaymentDto }>(`/wallet/${tab}`, { body: { amountCents: toCents(amount) } }),
    onSuccess: ({ payment }) => {
      setPending(payment);
      setError(null);
      qc.invalidateQueries({ queryKey: ['wallet'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (e) => setError((e as Error).message)
  });

  function onSubmit() {
    const schema = tab === 'deposit' ? depositSchema : withdrawSchema;
    const r = schema.safeParse({ amountCents: toCents(amount) });
    if (!r.success) return setError(r.error.issues[0]?.message ?? 'Invalid amount');
    submit.mutate();
  }

  const dep = tab === 'deposit';
  const limit = wallet?.weeklyDepositLimitCents ?? null;
  const used = wallet?.depositedThisWeekCents ?? 0;

  return (
    <main className="container page" style={{ maxWidth: 1200 }}>
      <h1 className="display" style={{ margin: 0, fontSize: 44 }}>WALLET</h1>

      <div className="stats">
        <div className="card card-gold stat">
          <span className="eyebrow gold">Cash balance</span>
          <strong className="num">{wallet ? formatKes(wallet.balanceCents) : '—'}</strong>
          <span className="muted">Withdrawable any time</span>
        </div>
        <div className="card stat">
          <span className="eyebrow">Weekly deposit limit</span>
          {limit === null ? (
            <span style={{ fontSize: 20, fontWeight: 700 }}>No limit set</span>
          ) : (
            <>
              <span style={{ fontSize: 20, fontWeight: 700 }} className="num">
                {formatKes(used)} <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}>of {formatKes(limit)}</span>
              </span>
              <div className="bar"><span style={{ width: `${Math.min(100, (used / Math.max(limit, 1)) * 100)}%` }} /></div>
            </>
          )}
          <Link to="/account">Change limit</Link>
        </div>
        <div className="card stat">
          <span className="eyebrow">Identity check</span>
          <span style={{ fontSize: 20, fontWeight: 700 }}>{me?.kycStatus === 'verified' ? 'Verified' : 'In review'}</span>
          <span className="muted">{me?.kycStatus === 'verified' ? 'Withdrawals unlocked' : 'Needed before your first withdrawal'}</span>
        </div>
      </div>

      <div className="split">
        <section className="card card-pad" style={{ flex: '1 1 420px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="segmented" role="tablist">
            {(['deposit', 'withdraw'] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => { setTab(t); setPending(null); setError(null); }}>
                {t === 'deposit' ? 'Deposit' : 'Withdraw'}
              </button>
            ))}
          </div>

          <div className="notice notice-ok" style={{ alignItems: 'center' }}>
            <span style={{ width: 44, height: 40, borderRadius: 10, background: 'var(--win)', color: '#08210F', fontWeight: 800, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>M-PESA</span>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <strong>{me?.phone}</strong>
              <span className="muted" style={{ fontSize: 12 }}>Your verified number · {dep ? 'prompt sent to your phone' : 'paid out within minutes'}</span>
            </div>
            <IconCheck style={{ color: 'var(--win)' }} />
          </div>

          <label className="field">
            Amount (KES)
            <input className="input input-lg num" type="number" inputMode="numeric" value={amount || ''} onChange={(e) => setAmount(Number(e.target.value) || 0)} />
          </label>
          <div className="grid-4">
            {(dep ? [100, 500, 1000, 5000] : [500, 1000, 2000, 5000]).map((q) => (
              <button key={q} type="button" className="chip-btn" onClick={() => setAmount(q)}>{q.toLocaleString('en-KE')}</button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 14, borderRadius: 12, background: 'var(--bar)', fontSize: 13 }}>
            <div className="row"><span className="muted">{dep ? 'You pay' : 'You receive'}</span><strong className="num">{formatKes(toCents(amount || 0))}</strong></div>
            <div className="row"><span className="muted">Fee</span><strong style={{ color: 'var(--win)' }}>Free</strong></div>
            <div className="row"><span className="muted">Limits</span><strong>{dep ? 'Min 10 · Max 150,000' : 'Min 50 · Max 150,000'}</strong></div>
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}

          {pending ? (
            <PaymentStatus p={pending} onDone={() => setPending(null)} />
          ) : (
            <button type="button" className="btn btn-gold btn-lg" disabled={submit.isPending} onClick={onSubmit}>
              {submit.isPending ? 'Sending…' : `${dep ? 'Deposit' : 'Withdraw'} ${formatKes(toCents(amount || 0))}`}
            </button>
          )}
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Empire Bet never asks you to send money to a paybill to unlock a withdrawal. If anyone does, report it to [SUPPORT CONTACT].
          </p>
        </section>

        <section className="card" style={{ flex: '1.3 1 460px', minWidth: 0 }}>
          <div className="card-head"><strong>Recent transactions</strong></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Type</th><th>Reference</th><th>Date</th><th className="right">Amount</th><th className="right">Balance</th></tr></thead>
              <tbody>
                {(tx.data?.entries ?? []).map((e) => (
                  <tr key={e.id}>
                    <td style={{ fontWeight: 600 }}>{KIND_LABEL[e.kind] ?? e.kind}</td>
                    <td className="muted" style={{ fontFamily: 'ui-monospace, monospace' }}>{e.note ?? '—'}</td>
                    <td className="muted">{new Date(e.createdAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td className="right num" style={{ fontWeight: 700, color: e.amountCents > 0 ? 'var(--win)' : 'var(--text)' }}>
                      {e.amountCents > 0 ? '+ ' : '− '}{formatKes(Math.abs(e.amountCents), false)}
                    </td>
                    <td className="right num muted">{formatKes(e.balanceAfter, false)}</td>
                  </tr>
                ))}
                {tx.data && tx.data.entries.length === 0 && (
                  <tr><td colSpan={5} className="muted">No transactions yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function PaymentStatus({ p, onDone }: { p: PaymentDto; onDone: () => void }) {
  const dep = p.type === 'deposit';
  const map: Record<string, { tone: string; title: string; body: string }> = {
    initiated: { tone: 'notice-gold', title: 'Check your phone', body: 'Enter your M-Pesa PIN on the prompt. Your balance updates as soon as Safaricom confirms.' },
    processing: { tone: 'notice-gold', title: 'Withdrawal on its way', body: `${formatKes(p.amountCents)} is being sent to your M-Pesa. No fee charged.` },
    pending_review: { tone: 'notice-gold', title: 'Withdrawal in review', body: 'Larger withdrawals get a quick manual check. Your funds are reserved and you will get an SMS when it is paid.' },
    completed: { tone: 'notice-ok', title: dep ? 'Deposit received' : 'Withdrawal paid', body: `${formatKes(p.amountCents)} · M-Pesa receipt ${p.mpesaReceipt ?? ''}` },
    failed: { tone: 'notice-bad', title: dep ? 'Deposit not completed' : 'Withdrawal failed', body: p.failureReason ?? 'Please try again.' },
    held: { tone: 'notice-bad', title: 'Payment on hold', body: 'Our team is checking this payment. Contact support if you need help.' },
    rejected: { tone: 'notice-bad', title: 'Withdrawal declined', body: `${p.failureReason ?? ''} Funds returned to your balance.` }
  };
  const s = map[p.status] ?? map.initiated;
  return (
    <div className={`notice ${s.tone}`} role="status">
      <IconPhone size={24} style={{ color: 'var(--gold)', flex: '0 0 auto' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        <strong>{s.title}</strong>
        <span className="muted" style={{ fontSize: 13 }}>{s.body}</span>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>Done</button>
    </div>
  );
}
