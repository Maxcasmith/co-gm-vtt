import HomePage from './HomePage.tsx';
import GamePage from './GamePage.tsx';
import PlayerCreatePage from './PlayerCreatePage.tsx';
import AdminPage from './AdminPage.tsx';

export default function App() {
  const parts = window.location.pathname.split('/').filter(Boolean);

  if (parts[0] === 'admin') return <AdminPage />;

  // /{campaignId}/player/create
  if (parts.length === 3 && parts[1] === 'player' && parts[2] === 'create') {
    return <PlayerCreatePage campaignId={parts[0]!} />;
  }

  // /{campaignId}/game
  if (parts.length === 2 && parts[1] === 'game') {
    return <GamePage campaignId={parts[0]!} />;
  }

  return <HomePage />;
}
