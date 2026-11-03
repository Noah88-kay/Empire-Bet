import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type EventDto, type SelectionDto } from '../lib/api';
import { useSlip } from '../state/betslip';
import { BetSlip } from '../components/BetSlip';

type Tab = 'All' | 'Live' | 'Today' | 'Upcoming' | 'Results';

function useEvents() {
  return useQuery({
    queryKey: ['events'],
    queryFn: () =>
      api<{ events: EventDto[]; sports: { sport: string; count: number }[]; feed: { lastOkAt: string | null; lastError: string | null } | null }>('/events'),
    refetchInterval: 15_000
  });
}

function useResults(enabled: boolean) {
  return useQuery({ queryKey: ['results'], queryFn: () => api<{ events: EventDto[] }>('/events/results'), enabled, refetchInterval: 60_000 });
}

/** Re-renders every `ms` so relative times ("updated 12s ago") stay current. */
function useNow(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const isToday = (d: Date) => d.toDateString() === new Date().toDateString();

function whenLabel(iso: string) {
  const d = new Date(iso);
  const tomorrow = new Date(Date.now() + 86400000);
  const day = isToday(d)
    ? 'Today'
    : d.toDateString() === tomorrow.toDateString()
      ? 'Tomorrow'
      : d.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' });
  return { day, time: d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false }) };
}

function ago(iso: string | null, now: number) {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

const hasOdds = (e: EventDto) => !!e.oddsUpdatedAt || e.source === 'manual';
const isOpen = (e: EventDto) => e.market?.status === 'open' && e.status === 'scheduled' && new Date(e.startsAt).getTime() > Date.now();

function OddButton({ e, s, large, label }: { e: EventDto; s: SelectionDto; large?: boolean; label?: string }) {
  const { picks, toggle } = useSlip();
  const on = picks.some((p) => p.selectionId === s.id);
  const open = isOpen(e);
  const pickName = s.code === 'X' ? 'Draw' : s.label;
  const shown = hasOdds(e) ? s.odds.toFixed(2) : '–';
  return (
    <button
      type="button"
      className={`odd ${large ? 'odd-lg' : ''} ${on ? 'on' : ''}`}
      aria-pressed={on}
      aria-label={`${pickName} at ${shown}, ${e.home} v ${e.away}`}
      disabled={!open}
      onClick={() => toggle({ eventId: e.id, selectionId: s.id, pick: pickName, match: `${e.home} v ${e.away}`, odds: s.odds })}
    >
      {large ? (
        <>
          <small>{label ?? s.code}</small>
          <span className="num">{shown}</span>
        </>
      ) : (
        shown
      )}
    </button>
  );
}

function MatchRow({ e }: { e: EventDto }) {
  const live = e.status === 'live';
  const done = e.status === 'finished' || e.status === 'cancelled';
  const started = live || done;
  const w = whenLabel(e.startsAt);
  const note = done ? null : live ? 'Betting closed at kickoff' : !hasOdds(e) ? 'Odds not available yet' : !isOpen(e) ? 'Suspended' : null;
  return (
    <div className="match">
      <div className="match-info">
        <div className="match-time">
          {live ? (
            <>
              <span className="badge-live">LIVE</span>
              <span style={{ color: 'var(--win)', fontWeight: 600 }}>{e.clock ?? (e.minute ? `${e.minute}'` : '')}</span>
            </>
          ) : done ? (
            <>
              <span className="muted">{w.day}</span>
              <span style={{ fontWeight: 700 }}>{e.status === 'cancelled' ? 'PST' : e.clock ?? 'FT'}</span>
            </>
          ) : (
            <>
              <span className="muted">{w.day}</span>
              <span style={{ fontWeight: 600 }}>{w.time}</span>
            </>
          )}
        </div>
        <div className="teams">
          <div><span className="score num">{started ? e.homeScore : ''}</span><span>{e.home}</span></div>
          <div><span className="score num">{started ? e.awayScore : ''}</span><span>{e.away}</span></div>
          {note && <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>{note}</span>}
        </div>
      </div>
      {!done && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {e.market?.selections.map((s) => <OddButton key={s.id} e={e} s={s} />)}
        </div>
      )}
      {done && e.status === 'cancelled' && <span className="tag tag-neutral">Postponed · bets void</span>}
    </div>
  );
}

function groupByLeague(list: EventDto[]) {
  const map = new Map<string, EventDto[]>();
  for (const e of list) map.set(e.league, [...(map.get(e.league) ?? []), e]);
  return [...map.entries()];
}

export function Sportsbook({ liveOnly = false }: { liveOnly?: boolean }) {
  const { data, isLoading, isError } = useEvents();
  const [tab, setTab] = useState<Tab>(liveOnly ? 'Live' : 'All');
  const [league, setLeague] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const results = useResults(tab === 'Results');
  const now = useNow(5000);

  useEffect(() => setTab(liveOnly ? 'Live' : 'All'), [liveOnly]);

  // Drop slip picks whose match has kicked off or left the feed. Moved odds are caught by the
  // server at placement, which asks the player to accept the new price.
  useEffect(() => {
    if (!data) return;
    const open = new Set(data.events.filter(isOpen).flatMap((e) => (e.market?.selections ?? []).map((s) => s.id)));
    useSlip.setState((st) => {
      const picks = st.picks.filter((p) => open.has(p.selectionId));
      return picks.length === st.picks.length ? st : { picks };
    });
  }, [data]);

  const events = data?.events ?? [];
  const featured = events.find((e) => e.featured && isOpen(e));
  const liveCount = events.filter((e) => e.status === 'live').length;
  const leagues = [...new Set(events.map((e) => e.league))];

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const source = tab === 'Results' ? results.data?.events ?? [] : events;
    const list = source
      .filter((e) =>
        tab === 'Live' ? e.status === 'live' : tab === 'Today' ? isToday(new Date(e.startsAt)) : tab === 'Upcoming' ? e.status === 'scheduled' : true
      )
      .filter((e) => !league || e.league === league)
      .filter((e) => !q || `${e.home} ${e.away} ${e.league}`.toLowerCase().includes(q));
    return groupByLeague(list);
  }, [events, results.data, tab, league, search]);

  const loading = tab === 'Results' ? results.isLoading : isLoading;

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
            <span className="eyebrow">Leagues</span>
            <button type="button" className={league === null ? 'on' : ''} onClick={() => setLeague(null)}>All leagues</button>
            {leagues.map((l) => (
              <button key={l} type="button" className={league === l ? 'on' : ''} onClick={() => setLeague(l)}>
                <span>{l}</span>
                <span className="muted num" style={{ fontSize: 12 }}>{events.filter((e) => e.league === l).length}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="main">
          {featured?.market && !liveOnly && (
            <section className="hero" aria-label="Featured match">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: '1 1 280px' }}>
                <span className="eyebrow gold">
                  Featured · {featured.league} · {whenLabel(featured.startsAt).day} {whenLabel(featured.startsAt).time}
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
              {(['All', 'Live', 'Today', 'Upcoming', 'Results'] as Tab[]).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} className={`pill ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
                  {t === 'Live' && liveCount > 0 ? `Live · ${liveCount}` : t}
                </button>
              ))}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="sr-only">Search teams or leagues</span>
              <input className="input" style={{ height: 44, width: 240 }} type="search" placeholder="Search teams, leagues" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
          </div>

          <p className="muted" style={{ margin: 0, fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }} role="status">
            <span className="live-dot" style={{ background: data?.feed?.lastOkAt ? 'var(--win)' : 'var(--muted)' }} />
            Live data · updated {ago(data?.feed?.lastOkAt ?? null, now)} · times shown in your time zone · pre-match odds, betting closes at kickoff
          </p>

          {loading && <div className="card card-pad muted">Loading fixtures…</div>}
          {isError && <div className="card card-pad form-error">Could not load fixtures. Is the API running?</div>}
          {!loading && groups.length === 0 && (
            <div className="card card-pad muted">
              {tab === 'Live' ? 'No matches in play right now.' : tab === 'Results' ? 'No results in the last 3 days.' : 'No matches here right now.'}
            </div>
          )}

          {groups.map(([lg, list]) => (
            <section className="card" key={lg}>
              <div className="card-head">
                <strong>{lg}</strong>
                {tab !== 'Results' && <div className="odds-head" aria-hidden="true"><span>1</span><span>X</span><span>2</span></div>}
              </div>
              {list.map((e) => <MatchRow key={e.id} e={e} />)}
            </section>
          ))}
        </div>

        <BetSlip />
      </div>
    </main>
  );
}
