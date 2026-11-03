import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type EventDto, type SelectionDto } from '../lib/api';
import { useSlip } from '../state/betslip';
import { BetSlip } from '../components/BetSlip';

type Tab = 'Highlights' | 'Live' | 'Upcoming';

function useEvents() {
  return useQuery({
    queryKey: ['events'],
    queryFn: () => api<{ events: EventDto[]; sports: { sport: string; count: number }[] }>('/events'),
    refetchInterval: 15_000
  });
}

function whenLabel(e: EventDto) {
  const d = new Date(e.startsAt);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  const day =
    d.toDateString() === today.toDateString() ? 'Today' : d.toDateString() === tomorrow.toDateString() ? 'Tomorrow' : d.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric' });
  return { day, time: d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false }) };
}

function OddButton({ e, s, large, label }: { e: EventDto; s: SelectionDto; large?: boolean; label?: string }) {
  const { picks, toggle } = useSlip();
  const on = picks.some((p) => p.selectionId === s.id);
  const disabled = e.market?.status !== 'open';
  const pickName = s.code === 'X' ? 'Draw' : s.label;
  return (
    <button
      type="button"
      className={`odd ${large ? 'odd-lg' : ''} ${on ? 'on' : ''}`}
      aria-pressed={on}
      aria-label={`${pickName} at ${s.odds.toFixed(2)}, ${e.home} v ${e.away}`}
      disabled={disabled}
      onClick={() => toggle({ eventId: e.id, selectionId: s.id, pick: pickName, match: `${e.home} v ${e.away}`, odds: s.odds })}
    >
      {large ? (
        <>
          <small>{label ?? s.code}</small>
          <span className="num">{s.odds.toFixed(2)}</span>
        </>
      ) : (
        s.odds.toFixed(2)
      )}
    </button>
  );
}

function MatchRow({ e }: { e: EventDto }) {
  const live = e.status === 'live';
  const w = whenLabel(e);
  return (
    <div className="match">
      <div className="match-info">
        <div className="match-time">
          {live ? (
            <>
              <span className="badge-live">LIVE</span>
              <span style={{ color: 'var(--win)', fontWeight: 600 }}>{e.minute}'</span>
            </>
          ) : (
            <>
              <span className="muted">{w.day}</span>
              <span style={{ fontWeight: 600 }}>{w.time}</span>
            </>
          )}
        </div>
        <div className="teams">
          <div><span className="score num">{live ? e.homeScore : ''}</span><span>{e.home}</span></div>
          <div><span className="score num">{live ? e.awayScore : ''}</span><span>{e.away}</span></div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {e.market?.selections.map((s) => <OddButton key={s.id} e={e} s={s} />)}
      </div>
    </div>
  );
}

export function Sportsbook({ liveOnly = false }: { liveOnly?: boolean }) {
  const { data, isLoading, isError } = useEvents();
  const [tab, setTab] = useState<Tab>(liveOnly ? 'Live' : 'Highlights');
  const [search, setSearch] = useState('');

  const featured = data?.events.find((e) => e.featured);
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (data?.events ?? [])
      .filter((e) => (tab === 'Live' ? e.status === 'live' : tab === 'Upcoming' ? e.status === 'scheduled' : true))
      .filter((e) => !q || `${e.home} ${e.away} ${e.league}`.toLowerCase().includes(q));
    const map = new Map<string, EventDto[]>();
    for (const e of list) map.set(e.league, [...(map.get(e.league) ?? []), e]);
    return [...map.entries()];
  }, [data, tab, search]);

  return (
    <main className="container page">
      <div className="split">
        <aside className="side side-stack">
          <div className="card side-list">
            <span className="eyebrow">Sports</span>
            {(data?.sports ?? [{ sport: 'Football', count: 0 }]).map((s, i) => (
              <button key={s.sport} type="button" className={i === 0 ? 'on' : ''}>
                <span>{s.sport}</span>
                <span className="muted num" style={{ fontSize: 12 }}>{s.count}</span>
              </button>
            ))}
          </div>
          <div className="card side-list">
            <span className="eyebrow">Top leagues</span>
            {[...new Set((data?.events ?? []).map((e) => e.league))].map((l) => (
              <button key={l} type="button" onClick={() => setSearch(l)}>{l}</button>
            ))}
          </div>
        </aside>

        <div className="main">
          {featured?.market && !liveOnly && (
            <section className="hero" aria-label="Featured match">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: '1 1 280px' }}>
                <span className="eyebrow gold">
                  Featured · {featured.league} · {whenLabel(featured).day} {whenLabel(featured).time}
                </span>
                <h1>
                  {featured.home} <span>vs</span> {featured.away}
                </h1>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {featured.market.selections.map((s) => (
                  <OddButton key={s.id} e={featured} s={s} large label={s.code === 'X' ? 'Draw' : s.label} />
                ))}
              </div>
            </section>
          )}

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="pills" role="tablist" aria-label="Fixtures">
              {(['Highlights', 'Live', 'Upcoming'] as Tab[]).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} className={`pill ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
                  {t}
                </button>
              ))}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="sr-only">Search teams or leagues</span>
              <input className="input" style={{ height: 44, width: 240 }} type="search" placeholder="Search teams, leagues" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
          </div>

          {isLoading && <div className="card card-pad muted">Loading fixtures…</div>}
          {isError && <div className="card card-pad form-error">Could not load fixtures. Is the API running?</div>}
          {!isLoading && groups.length === 0 && <div className="card card-pad muted">No matches here right now.</div>}

          {groups.map(([league, events]) => (
            <section className="card" key={league}>
              <div className="card-head">
                <strong>{league}</strong>
                <div className="odds-head" aria-hidden="true"><span>1</span><span>X</span><span>2</span></div>
              </div>
              {events.map((e) => <MatchRow key={e.id} e={e} />)}
            </section>
          ))}
        </div>

        <BetSlip />
      </div>
    </main>
  );
}
