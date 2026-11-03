import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { formatKes } from '@empire/shared';
import { useMe, useWallet } from '../lib/hooks';
import { useToast } from '../state/toast';
import { IconGrid, IconHome, IconLive, IconTicket, IconUser, Logo } from './Icons';

export function Brand({ size = 36 }: { size?: number }) {
  return (
    <Link to="/" className="brand" aria-label="Empire Bet home">
      <Logo size={size} />
      <span className="wordmark">EMPIRE<b>BET</b></span>
    </Link>
  );
}

function Header() {
  const { data: me } = useMe();
  const { data: wallet } = useWallet(!!me);
  return (
    <header className="header">
      <div className="container">
        <Brand />
        <nav className="nav" aria-label="Primary">
          <NavLink to="/" end>Sports</NavLink>
          <NavLink to="/live"><span className="live-dot" />Live</NavLink>
          <NavLink to="/casino">Casino</NavLink>
          <NavLink to="/bets">My Bets</NavLink>
          {me && me.role !== 'player' && <NavLink to="/admin">Back office</NavLink>}
        </nav>
        <div className="header-actions">
          {me ? (
            <>
              <Link to="/wallet" className="balance-chip">
                <small>Balance</small>
                <span className="num">{wallet ? formatKes(wallet.balanceCents) : '—'}</span>
              </Link>
              <Link to="/wallet" className="btn btn-gold">Deposit</Link>
              <Link to="/account" className="icon-btn" aria-label="Account"><IconUser /></Link>
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost">Log in</Link>
              <Link to="/register" className="btn btn-gold">Join now</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <span className="age">18+</span>
          <span style={{ maxWidth: 540 }}>
            Licensed by the Betting Control &amp; Licensing Board, licence no. [BCLB LICENCE NO.]. Bet responsibly. Set deposit limits or take a break any
            time from your account.
          </span>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <Link to="/account">Responsible gaming</Link>
          <a href="#">Terms</a>
          <a href="#">Privacy</a>
          <a href="#">Help centre</a>
        </div>
      </div>
    </footer>
  );
}

function TabBar() {
  return (
    <nav className="tabbar" aria-label="App">
      <NavLink to="/" end><IconHome size={22} />Home</NavLink>
      <NavLink to="/live"><IconLive size={22} />Live</NavLink>
      <NavLink to="/bets"><IconTicket size={22} />My Bets</NavLink>
      <NavLink to="/casino"><IconGrid size={22} />Casino</NavLink>
      <NavLink to="/account"><IconUser size={22} />Account</NavLink>
    </nav>
  );
}

function Toast() {
  const { message, tone } = useToast();
  if (!message) return null;
  const cls = tone === 'bad' ? 'notice-bad' : tone === 'gold' ? 'notice-gold' : 'notice-ok';
  return (
    <div role="status" className={`toast ${cls}`}>
      {message}
    </div>
  );
}

export function Layout() {
  const { pathname } = useLocation();
  const bare = pathname === '/login' || pathname === '/register';
  return (
    <>
      <Header />
      <Outlet />
      {!bare && <Footer />}
      <TabBar />
      <Toast />
    </>
  );
}
