import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { combineOdds, formatKes, MIN_STAKE_CENTS, potentialPayoutCents, toCents } from '@empire/shared';
import { api, ApiError } from '../lib/api';
import { useMe, useWallet } from '../lib/hooks';
import { useSlip } from '../state/betslip';
import { IconCheck, IconTicket, IconX } from './Icons';

export function BetSlip() {
  const { picks, stakeKes, setStake, remove, clear, updateOdds } = useSlip();
  const { data: me } = useMe();
  const { data: wallet } = useWallet(!!me);
  const qc = useQueryClient();
  const nav = useNavigate();
  const [placed, setPlaced] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [oddsChanged, setOddsChanged] = useState(false);

  const total = combineOdds(picks.map((p) => p.odds));
  const stakeCents = toCents(stakeKes || 0);
  const payout = potentialPayoutCents(stakeCents, total);

  const place = useMutation({
    mutationFn: (acceptOddsChanges: boolean) =>
      api<{ bet: { ticket: string } }>('/bets', {
        body: { stakeCents, selections: picks.map((p) => ({ selectionId: p.selectionId, odds: p.odds })), acceptOddsChanges }
      }),
    onSuccess: ({ bet }) => {
      setPlaced(bet.ticket);
      setError(null);
      setOddsChanged(false);
      clear();
      qc.invalidateQueries({ queryKey: ['wallet'] });
      qc.invalidateQueries({ queryKey: ['bets'] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'odds_changed') {
        updateOdds(e.details?.changed ?? []);
        setOddsChanged(true);
        setError('Odds have moved. Check the new prices and confirm.');
        return;
      }
      setError(e instanceof Error ? e.message : 'Could not place bet');
    }
  });

  const stakeTooLow = stakeCents < MIN_STAKE_CENTS;
  const tooHigh = wallet ? stakeCents > wallet.balanceCents : false;

  function onPlace() {
    if (!me) return nav('/login', { state: { from: '/' } });
    if (!me.phoneVerified) return nav('/register');
    place.mutate(oddsChanged);
  }

  return (
    <>
    {picks.length > 0 && (
      <a href="#betslip" className="slip-fab">
        <span>Bet slip · {picks.length}</span>
        <span className="num">Odds {total.toFixed(2)}</span>
      </a>
    )}
    <aside id="betslip" className="card rail" aria-label="Bet slip" style={{ scrollMarginTop: 80 }}>
      <div className="slip-head">
        <span className="slip-title">BET SLIP</span>
        <span className="count">{picks.length}</span>
      </div>

      {picks.length === 0 && !placed && (
        <div className="empty">
          <IconTicket size={40} style={{ color: '#4A5263' }} />
          <strong>Your slip is empty</strong>
          <span>Tap any odds to add a selection.</span>
        </div>
      )}

      {placed && picks.length === 0 && (
        <div className="slip-body">
          <div className="notice notice-ok" style={{ alignItems: 'center' }}>
            <IconCheck size={22} style={{ color: 'var(--win)' }} />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <strong style={{ color: 'var(--win)' }}>Bet placed</strong>
              <span className="muted" style={{ fontSize: 12 }}>
                Ticket {placed} · <Link to="/bets">track it in My Bets</Link>
              </span>
            </div>
          </div>
        </div>
      )}

      {picks.length > 0 && (
        <>
          {picks.map((p) => (
            <div className="slip-item" key={p.selectionId}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <strong>{p.pick}</strong>
                <span className="muted" style={{ fontSize: 12 }}>1X2 · {p.match}</span>
              </div>
              <strong className="num" style={{ color: 'var(--gold)' }}>{p.odds.toFixed(2)}</strong>
              <button type="button" className="x" aria-label={`Remove ${p.pick}`} onClick={() => remove(p.selectionId)}>
                <IconX size={16} />
              </button>
            </div>
          ))}
          <div className="slip-body">
            <div className="row">
              <span className="muted">Total odds</span>
              <strong className="num">{total.toFixed(2)}</strong>
            </div>
            <label className="field">
              Stake (KES)
              <input
                className="input"
                type="number"
                min={10}
                inputMode="numeric"
                value={stakeKes || ''}
                onChange={(e) => setStake(Number(e.target.value) || 0)}
              />
            </label>
            <div className="grid-4">
              {[50, 100, 500, 1000].map((q) => (
                <button key={q} type="button" className="chip-btn" onClick={() => setStake((stakeKes || 0) + q)}>
                  +{q}
                </button>
              ))}
            </div>
            <div className="row" style={{ paddingTop: 6, borderTop: '1px dashed var(--line-2)' }}>
              <span className="muted">Potential payout</span>
              <span className="payout num">{formatKes(payout)}</span>
            </div>
            <span className="muted" style={{ fontSize: 11 }}>Payout shown before any tax required by law.</span>
            {error && <p className="form-error" role="alert">{error}</p>}
            {stakeTooLow && <p className="form-error">Minimum stake is KES 10.</p>}
            {tooHigh && (
              <p className="form-error">
                Not enough balance. <Link to="/wallet">Deposit</Link>
              </p>
            )}
            <button type="button" className="btn btn-gold btn-lg btn-block" disabled={place.isPending || stakeTooLow || tooHigh} onClick={onPlace}>
              {place.isPending ? 'Placing…' : oddsChanged ? 'Accept new odds & place' : `Place bet · ${formatKes(stakeCents)}`}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>
              Clear slip
            </button>
          </div>
        </>
      )}
    </aside>
    </>
  );
}
