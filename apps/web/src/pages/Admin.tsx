import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatKes } from '@empire/shared';
import { api } from '../lib/api';
import { useToast } from '../state/toast';

type Section = 'overview' | 'withdrawals' | 'kyc' | 'events' | 'audit';

interface Overview { depositsCents: number; withdrawalsCents: number; ggrCents: number; activePlayers: number }
interface ReviewItem { id: string; amountCents: number; status: string; createdAt: string; failureReason: string | null; user: { id: string; name: string; kycStatus: string } }
interface AdminEvent { id: string; league: string; home: string; away: string; status: string; startsAt: string; openBets: number; liabilityCents: number }
interface KycUser { id: string; name: string; nationalId: string; dateOfBirth: string; createdAt: string }
interface AuditItem { id: string; actor: string; action: string; target: string | null; createdAt: string }

export function Admin() {
  const [section, setSection] = useState<Section>('overview');
  const links: [Section, string][] = [
    ['overview', 'Overview'],
    ['withdrawals', 'Withdrawals'],
    ['kyc', 'Players & KYC'],
    ['events', 'Events & settlement'],
    ['audit', 'Audit log']
  ];
  return (
    <main className="container page">
      <div className="split">
        <nav className="card side-list side" aria-label="Back office">
          <span className="eyebrow">Back office</span>
          {links.map(([k, label]) => (
            <button key={k} type="button" className={section === k ? 'on' : ''} onClick={() => setSection(k)}>{label}</button>
          ))}
        </nav>
        <div className="main">
          {section === 'overview' && <OverviewPanel />}
          {section === 'withdrawals' && <WithdrawalsPanel />}
          {section === 'kyc' && <KycPanel />}
          {section === 'events' && <EventsPanel />}
          {section === 'audit' && <AuditPanel />}
        </div>
      </div>
    </main>
  );
}

function OverviewPanel() {
  const { data } = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api<Overview>('/admin/overview'), refetchInterval: 30_000 });
  const tiles = [
    ['Deposits today', data && formatKes(data.depositsCents), 'M-Pesa STK, auto-reconciled'],
    ['Withdrawals paid', data && formatKes(data.withdrawalsCents), 'M-Pesa B2C'],
    ['Gross gaming revenue', data && formatKes(data.ggrCents), 'Stakes − winnings, sports + casino'],
    ['Active players', data?.activePlayers.toString(), 'Placed a bet today']
  ];
  return (
    <>
      <h1 className="display" style={{ margin: 0, fontSize: 38 }}>OVERVIEW · TODAY</h1>
      <div className="stats">
        {tiles.map(([label, value, note]) => (
          <div key={label} className="card stat">
            <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
            <strong className="num">{value ?? '—'}</strong>
            <span className="muted" style={{ fontSize: 12 }}>{note}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function WithdrawalsPanel() {
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const { data } = useQuery({ queryKey: ['admin', 'withdrawals'], queryFn: () => api<{ items: ReviewItem[] }>('/admin/withdrawals') });
  const act = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: 'approve' | 'hold' | 'reject'; reason?: string }) =>
      api(`/admin/withdrawals/${id}/${action}`, { body: reason ? { reason } : {} }),
    onSuccess: (_d, v) => {
      toast(`Withdrawal ${v.action === 'approve' ? 'approved' : v.action === 'hold' ? 'held' : 'rejected'}`);
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => toast((e as Error).message, 'bad')
  });

  return (
    <section className="card">
      <div className="card-head"><strong>Withdrawals needing review</strong><span className="muted" style={{ fontSize: 12 }}>Small withdrawals with verified ID pay automatically</span></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Player</th><th>Amount</th><th>ID</th><th>Status</th><th>Requested</th><th className="right">Action</th></tr></thead>
          <tbody>
            {data?.items.map((w) => (
              <tr key={w.id}>
                <td><strong>{w.user.name}</strong></td>
                <td className="num" style={{ fontWeight: 700 }}>{formatKes(w.amountCents)}</td>
                <td><span className={`tag ${w.user.kycStatus === 'verified' ? 'tag-ok' : 'tag-wait'}`}>{w.user.kycStatus}</span></td>
                <td><span className="tag tag-neutral">{w.status.replace('_', ' ')}</span></td>
                <td className="muted">{new Date(w.createdAt).toLocaleString('en-KE')}</td>
                <td className="right" style={{ whiteSpace: 'nowrap' }}>
                  {w.status === 'pending_review' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => act.mutate({ id: w.id, action: 'hold' })}>Hold</button>}{' '}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      const reason = window.prompt('Reason for declining (the player sees this)');
                      if (reason) act.mutate({ id: w.id, action: 'reject', reason });
                    }}
                  >
                    Decline
                  </button>{' '}
                  <button type="button" className="btn btn-gold btn-sm" onClick={() => act.mutate({ id: w.id, action: 'approve' })}>Approve</button>
                </td>
              </tr>
            ))}
            {data?.items.length === 0 && <tr><td colSpan={6} className="muted">Nothing waiting.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function KycPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin', 'kyc'], queryFn: () => api<{ users: KycUser[] }>('/admin/kyc') });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'verified' | 'rejected' }) => api(`/admin/kyc/${id}`, { body: { decision } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] })
  });
  return (
    <section className="card">
      <div className="card-head"><strong>Identity checks</strong><span className="muted" style={{ fontSize: 12 }}>Match the ID number against [ID VERIFICATION PROVIDER]</span></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Name</th><th>National ID</th><th>Date of birth</th><th>Joined</th><th className="right">Decision</th></tr></thead>
          <tbody>
            {data?.users.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.name}</strong></td>
                <td className="num">{u.nationalId}</td>
                <td>{new Date(u.dateOfBirth).toLocaleDateString('en-KE')}</td>
                <td className="muted">{new Date(u.createdAt).toLocaleDateString('en-KE')}</td>
                <td className="right" style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => decide.mutate({ id: u.id, decision: 'rejected' })}>Reject</button>{' '}
                  <button type="button" className="btn btn-gold btn-sm" onClick={() => decide.mutate({ id: u.id, decision: 'verified' })}>Verify</button>
                </td>
              </tr>
            ))}
            {data?.users.length === 0 && <tr><td colSpan={5} className="muted">No pending checks.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EventsPanel() {
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const { data } = useQuery({ queryKey: ['admin', 'events'], queryFn: () => api<{ events: AdminEvent[] }>('/admin/events') });
  const settle = useMutation({
    mutationFn: ({ id, homeScore, awayScore }: { id: string; homeScore: number; awayScore: number }) =>
      api<{ settled: number }>(`/admin/events/${id}/settle`, { body: { homeScore, awayScore } }),
    onSuccess: (r) => {
      toast(`Result recorded · ${r.settled} bets settled`);
      qc.invalidateQueries();
    },
    onError: (e) => toast((e as Error).message, 'bad')
  });

  return (
    <section className="card">
      <div className="card-head">
        <strong>Events &amp; liability</strong>
        <span className="muted" style={{ fontSize: 12 }}>Manual result entry until [ODDS PROVIDER] results feed is connected</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Match</th><th>Status</th><th>Open bets</th><th>Max liability</th><th className="right">Final score</th></tr></thead>
          <tbody>
            {data?.events.map((e) => <EventRow key={e.id} e={e} onSettle={(h, a) => settle.mutate({ id: e.id, homeScore: h, awayScore: a })} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EventRow({ e, onSettle }: { e: AdminEvent; onSettle: (h: number, a: number) => void }) {
  const [h, setH] = useState('');
  const [a, setA] = useState('');
  return (
    <tr>
      <td><strong>{e.home} v {e.away}</strong><div className="muted" style={{ fontSize: 12 }}>{e.league}</div></td>
      <td><span className={`tag ${e.status === 'live' ? 'tag-bad' : 'tag-neutral'}`}>{e.status}</span></td>
      <td className="num">{e.openBets}</td>
      <td className="num" style={{ fontWeight: 700 }}>{formatKes(e.liabilityCents)}</td>
      <td className="right" style={{ whiteSpace: 'nowrap' }}>
        <input aria-label={`${e.home} goals`} className="input num" style={{ width: 56, height: 36, display: 'inline-block', padding: '0 8px' }} value={h} onChange={(ev) => setH(ev.target.value.replace(/\D/g, ''))} />
        {' – '}
        <input aria-label={`${e.away} goals`} className="input num" style={{ width: 56, height: 36, display: 'inline-block', padding: '0 8px' }} value={a} onChange={(ev) => setA(ev.target.value.replace(/\D/g, ''))} />{' '}
        <button
          type="button"
          className="btn btn-gold btn-sm"
          disabled={h === '' || a === ''}
          onClick={() => window.confirm(`Settle ${e.home} ${h} – ${a} ${e.away}? This pays out winning bets.`) && onSettle(Number(h), Number(a))}
        >
          Settle
        </button>
      </td>
    </tr>
  );
}

function AuditPanel() {
  const { data } = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => api<{ items: AuditItem[] }>('/admin/audit') });
  return (
    <section className="card">
      <div className="card-head"><strong>Audit log</strong></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Time</th><th>Who</th><th>Action</th><th>Target</th></tr></thead>
          <tbody>
            {data?.items.map((i) => (
              <tr key={i.id}>
                <td className="muted">{new Date(i.createdAt).toLocaleString('en-KE')}</td>
                <td>{i.actor}</td>
                <td>{i.action}</td>
                <td className="muted" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{i.target ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
