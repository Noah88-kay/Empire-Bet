import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COIN_MULTIPLIER, diceMultiplier, formatKes, toCents } from '@empire/shared';
import { api } from '../lib/api';
import { useMe, useWallet } from '../lib/hooks';

const ORIGINALS = [
  { slug: 'dice', name: 'ROYAL DICE', kind: 'Dice', rtp: '98%', bg: '#1C1A33', ring: '#8E86FF33', live: true },
  { slug: 'coin', name: 'COIN TOSS', kind: 'Coin', rtp: '98%', bg: '#1A2230', ring: '#6FB4FF33', live: true },
  { slug: 'crash', name: 'CROWN CRASH', kind: 'Crash', rtp: '97%', bg: '#2A1E08', ring: '#E8B54A33', live: false },
  { slug: 'mines', name: 'EMPIRE MINES', kind: 'Grid', rtp: '97%', bg: '#0F2A1C', ring: '#3DDC8433', live: false },
  { slug: 'plinko', name: 'PLINKO', kind: 'Drop', rtp: '97%', bg: '#2A1418', ring: '#FF5A5F33', live: false },
  { slug: 'keno', name: 'KENO KING', kind: 'Keno', rtp: '96%', bg: '#2A2410', ring: '#F5CD7233', live: false }
];

export function CasinoLobby() {
  return (
    <main className="container page">
      <section className="hero" style={{ background: 'var(--gold-ink)', borderColor: 'var(--gold-dim)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: '1 1 280px' }}>
          <span className="eyebrow gold">Empire originals</span>
          <h1>ROYAL DICE</h1>
          <p className="muted" style={{ margin: 0, maxWidth: 380 }}>Pick your odds, roll once. Every result is provably fair and checkable from your fairness page.</p>
          <Link to="/casino/dice" className="btn btn-gold" style={{ alignSelf: 'flex-start' }}>Play now</Link>
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 className="display" style={{ margin: 0, fontSize: 28 }}>EMPIRE ORIGINALS</h2>
        <div className="game-grid">
          {ORIGINALS.map((g) => {
            const inner = (
              <>
                <div className="game-art" style={{ background: g.bg }}>
                  <span className="ring" style={{ borderColor: g.ring }} />
                  <span className="tag-orig">ORIGINAL</span>
                  {!g.live && <span className="soon">COMING SOON</span>}
                  <span className="name">{g.name}</span>
                </div>
                <div className="row muted" style={{ fontSize: 12 }}><span>{g.kind}</span><span>RTP {g.rtp}</span></div>
              </>
            );
            return g.live ? (
              <Link key={g.slug} to={`/casino/${g.slug}`} className="game-tile">{inner}</Link>
            ) : (
              <div key={g.slug} className="game-tile" aria-disabled="true" style={{ opacity: 0.6 }}>{inner}</div>
            );
          })}
        </div>
      </section>

      <section className="card card-pad muted">
        Slots and live tables from licensed studios plug in through a game aggregator ([GAME AGGREGATOR]). They are not wired up in this build.
      </section>
    </main>
  );
}

interface RoundResult {
  win: boolean;
  payoutCents: number;
  balanceCents: number;
  nonce: number;
  serverSeedHash: string;
  outcome: { roll?: number; side?: string };
}

function useRound(path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: object) => api<RoundResult>(`/games/${path}`, { body }),
    onSuccess: (r) => {
      qc.setQueryData(['wallet'], (w: any) => (w ? { ...w, balanceCents: r.balanceCents } : w));
      qc.invalidateQueries({ queryKey: ['fairness'] });
    }
  });
}

function GameFrame({ title, children, side }: { title: string; children: React.ReactNode; side: React.ReactNode }) {
  const { data: me } = useMe();
  const { data: wallet } = useWallet(!!me);
  return (
    <main className="container page" style={{ maxWidth: 1100 }}>
      <div className="row">
        <h1 className="display" style={{ margin: 0, fontSize: 40 }}>{title}</h1>
        <Link to="/casino">Back to lobby</Link>
      </div>
      {!me && <div className="notice notice-gold"><span><Link to="/login">Log in</Link> to play for real money.</span></div>}
      <div className="split">
        <section className="card card-pad" style={{ flex: '2 1 420px', display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'stretch' }}>
          {children}
        </section>
        <aside className="card card-pad" style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span className="eyebrow">Balance</span>
          <strong className="display num" style={{ fontSize: 34 }}>{wallet ? formatKes(wallet.balanceCents) : '—'}</strong>
          {side}
          <FairnessPanel />
        </aside>
      </div>
    </main>
  );
}

function FairnessPanel() {
  const { data: me } = useMe();
  const { data } = useQuery({
    queryKey: ['fairness'],
    queryFn: () => api<{ serverSeedHash: string; clientSeed: string; nonce: number }>('/games/fairness'),
    enabled: !!me
  });
  if (!data) return null;
  return (
    <details style={{ fontSize: 12, color: 'var(--muted)' }}>
      <summary style={{ cursor: 'pointer', color: 'var(--text-2)', fontWeight: 600 }}>Provably fair</summary>
      <p style={{ wordBreak: 'break-all' }}>Server seed hash: {data.serverSeedHash}</p>
      <p>Client seed: {data.clientSeed} · Next nonce: {data.nonce}</p>
      <p>Each result = HMAC-SHA256(server seed, "client seed:nonce"). Rotate your seed to reveal the server seed and verify past rounds.</p>
    </details>
  );
}

function StakeInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <>
      <label className="field">
        Stake (KES)
        <input className="input input-lg num" type="number" min={10} value={value || ''} onChange={(e) => onChange(Number(e.target.value) || 0)} />
      </label>
      <div className="grid-4">
        {[10, 50, 100, 500].map((q) => (
          <button key={q} type="button" className="chip-btn" onClick={() => onChange(q)}>{q}</button>
        ))}
      </div>
    </>
  );
}

export function DiceGame() {
  const [stake, setStake] = useState(50);
  const [target, setTarget] = useState(50);
  const [direction, setDirection] = useState<'over' | 'under'>('over');
  const round = useRound('dice');
  const mult = diceMultiplier(target, direction);
  const chance = direction === 'over' ? 100 - target : target;
  const r = round.data;

  return (
    <GameFrame
      title="ROYAL DICE"
      side={
        <>
          <div className="row"><span className="muted">Win chance</span><strong className="num">{chance.toFixed(2)}%</strong></div>
          <div className="row"><span className="muted">Multiplier</span><strong className="num">{mult.toFixed(4)}×</strong></div>
          <div className="row"><span className="muted">Payout on win</span><strong className="num" style={{ color: 'var(--win)' }}>{formatKes(Math.floor(toCents(stake) * mult))}</strong></div>
        </>
      }
    >
      <div style={{ textAlign: 'center', padding: '18px 0' }}>
        <div className="display num" style={{ fontSize: 96, lineHeight: 1, color: r ? (r.win ? 'var(--win)' : 'var(--loss)') : 'var(--text)' }}>
          {r?.outcome.roll !== undefined ? r.outcome.roll.toFixed(2) : '00.00'}
        </div>
        <p className="muted" style={{ margin: '8px 0 0' }} role="status">
          {r ? (r.win ? `You won ${formatKes(r.payoutCents)}` : 'No win this time') : `Roll ${direction} ${target} to win`}
        </p>
      </div>
      <label className="field">
        Target: {direction} {target}
        <input type="range" min={2} max={98} value={target} onChange={(e) => setTarget(Number(e.target.value))} style={{ accentColor: 'var(--gold)' }} />
      </label>
      <div className="segmented">
        {(['under', 'over'] as const).map((d) => (
          <button key={d} type="button" className={direction === d ? 'on' : ''} onClick={() => setDirection(d)}>Roll {d}</button>
        ))}
      </div>
      <StakeInput value={stake} onChange={setStake} />
      {round.error && <p className="form-error" role="alert">{(round.error as Error).message}</p>}
      <button type="button" className="btn btn-gold btn-lg" disabled={round.isPending} onClick={() => round.mutate({ stakeCents: toCents(stake), target, direction })}>
        {round.isPending ? 'Rolling…' : `Roll · ${formatKes(toCents(stake))}`}
      </button>
    </GameFrame>
  );
}

export function CoinGame() {
  const [stake, setStake] = useState(50);
  const [side, setSide] = useState<'heads' | 'tails'>('heads');
  const round = useRound('coin');
  const r = round.data;
  return (
    <GameFrame
      title="COIN TOSS"
      side={
        <>
          <div className="row"><span className="muted">Win chance</span><strong>50%</strong></div>
          <div className="row"><span className="muted">Multiplier</span><strong className="num">{COIN_MULTIPLIER}×</strong></div>
        </>
      }
    >
      <div style={{ textAlign: 'center', padding: '18px 0' }}>
        <div
          aria-hidden="true"
          style={{ width: 140, height: 140, margin: '0 auto', borderRadius: '50%', background: r?.outcome.side === 'tails' ? 'var(--surface-2)' : 'var(--gold)', border: '6px solid var(--gold-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: r?.outcome.side === 'tails' ? 'var(--gold)' : 'var(--gold-ink)', fontFamily: 'var(--display)', fontWeight: 800, fontSize: 30 }}
        >
          {(r?.outcome.side ?? side).toUpperCase()}
        </div>
        <p className="muted" role="status" style={{ margin: '12px 0 0' }}>
          {r ? (r.win ? `It's ${r.outcome.side}. You won ${formatKes(r.payoutCents)}` : `It's ${r.outcome.side}. No win this time`) : 'Pick a side'}
        </p>
      </div>
      <div className="segmented">
        {(['heads', 'tails'] as const).map((s) => (
          <button key={s} type="button" className={side === s ? 'on' : ''} onClick={() => setSide(s)}>{s === 'heads' ? 'Heads' : 'Tails'}</button>
        ))}
      </div>
      <StakeInput value={stake} onChange={setStake} />
      {round.error && <p className="form-error" role="alert">{(round.error as Error).message}</p>}
      <button type="button" className="btn btn-gold btn-lg" disabled={round.isPending} onClick={() => round.mutate({ stakeCents: toCents(stake), side })}>
        {round.isPending ? 'Flipping…' : `Flip · ${formatKes(toCents(stake))}`}
      </button>
    </GameFrame>
  );
}
