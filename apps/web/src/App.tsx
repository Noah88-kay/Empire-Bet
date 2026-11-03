import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useMe } from './lib/hooks';
import { Sportsbook } from './pages/Sportsbook';
import { Login, Register } from './pages/Auth';
import { Wallet } from './pages/Wallet';
import { CasinoLobby, CoinGame, DiceGame } from './pages/Casino';
import { MyBets } from './pages/MyBets';
import { Account } from './pages/Account';
import { Admin } from './pages/Admin';

function RequireAuth({ children, staff = false }: { children: ReactNode; staff?: boolean }) {
  const { data: me, isLoading } = useMe();
  const loc = useLocation();
  if (isLoading) return null;
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (!me.phoneVerified) return <Navigate to="/register" replace />;
  if (staff && me.role === 'player') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Sportsbook />} />
        <Route path="live" element={<Sportsbook liveOnly />} />
        <Route path="casino" element={<CasinoLobby />} />
        <Route path="casino/dice" element={<DiceGame />} />
        <Route path="casino/coin" element={<CoinGame />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="wallet" element={<RequireAuth><Wallet /></RequireAuth>} />
        <Route path="bets" element={<RequireAuth><MyBets /></RequireAuth>} />
        <Route path="account" element={<RequireAuth><Account /></RequireAuth>} />
        <Route path="admin" element={<RequireAuth staff><Admin /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
