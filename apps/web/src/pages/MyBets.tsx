import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatKes } from '@empire/shared';
import { api, type BetDto } from '../lib/api';

const RESULT_TAG: Record<string, string> = { won: 'tag-ok', lost: 'tag-bad', void: 'tag-neutral', pending: 'tag-wait', open: 'tag-wait' };

export function MyBets() {
  const [tab, setTab] = useState<'open' | 'settled'>('open');
  const { data, isLoading } = useQuery({
    queryKey: ['bets', tab],
    queryFn: () => api<{ bets: BetDto[] }>(`/bets?status=${tab}`),
    refetchInterval: 20_000
  });

  return (
    <main className="container page" style={{ maxWidth: 880 }}>
      <h1 className="display" style={{ margin: 0, fontSize: 44 }}>MY BETS</h1>
      <div className="segmented" role="tablist" style={{ maxWidth: 360 }}>
        {(['open', 'settled'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'open' ? 'Open' : 'Settled'}
          </button>
        ))}
      </div>

      {isLoading && <div className="card card-pad muted">Loading…</div>}
      {data?.bets.length === 0 && <div className="card card-pad muted">{tab === 'open' ? 'No open bets.' : 'No settled bets yet.'}</div>}

      {data?.bets.map((b) => {
        const won = b.legs.filter((l) => l.result === 'won').length;
        return (
          <article key={b.id} className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="row" style={{ fontSize: 12 }}>
              <span className="muted">{b.legs.length > 1 ? `Multi · ${b.legs.length} legs` : 'Single'} · {b.ticket}</span>
              <span className={`tag ${RESULT_TAG[b.status]}`}>{b.status === 'open' ? `${won} of ${b.legs.length} won` : b.status.toUpperCase()}</span>
            </div>
            {b.legs.length > 1 && (
              <div style={{ display: 'flex', gap: 6 }} aria-hidden="true">
                {b.legs.map((l) => (
                  <span key={l.id} style={{ flex: 1, height: 6, borderRadius: 3, background: l.result === 'won' ? 'var(--win)' : l.result === 'lost' ? 'var(--loss)' : 'var(--line-2)' }} />
                ))}
              </div>
            )}
            {b.legs.map((l) => (
              <div key={l.id} className="row" style={{ borderTop: '1px solid #1c212b', paddingTop: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <strong>{l.pick} <span className="muted num" style={{ fontWeight: 500 }}>@ {l.odds.toFixed(2)}</span></strong>
                  <span className="muted" style={{ fontSize: 12 }}>{l.match}{l.score ? ` · ${l.score}` : ''}{l.eventStatus === 'live' ? ' · LIVE' : ''}</span>
                </div>
                <span className={`tag ${RESULT_TAG[l.result]}`}>{l.result}</span>
              </div>
            ))}
            <div className="row" style={{ borderTop: '1px dashed var(--line-2)', paddingTop: 10 }}>
              <span className="muted">Stake {formatKes(b.stakeCents)} · odds {b.totalOdds.toFixed(2)}</span>
              <strong className="num" style={{ color: b.status === 'won' ? 'var(--win)' : undefined }}>
                {b.status === 'won'
                  ? `Paid ${formatKes(b.payoutCents ?? 0)}`
                  : b.status === 'void'
                    ? `Refunded ${formatKes(b.payoutCents ?? b.stakeCents)}`
                    : b.status === 'lost'
                      ? 'No return'
                      : `Returns ${formatKes(b.potentialPayoutCents)}`}
              </strong>
            </div>
          </article>
        );
      })}
    </main>
  );
}
