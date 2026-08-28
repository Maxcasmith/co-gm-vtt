import HomePage from './HomePage.tsx';
import GamePage from './GamePage.tsx';
import GameLobbyPage from './GameLobbyPage.tsx';
import PlayerCreatePage from './PlayerCreatePage.tsx';
import GameSettingsPage from './GameSettingsPage.tsx';
import AdminLayout from './AdminLayout.tsx';
import LicenseGate from './LicenseGate.tsx';

export default function App() {
  const parts = window.location.pathname.split('/').filter(Boolean);

  return <LicenseGate>{renderRoute(parts)}</LicenseGate>;
}

function renderRoute(parts: string[]) {
  if (parts[0] === 'admin') return <AdminLayout initialTab={parts[1] === 'resources' ? 'resources' : 'campaigns'} />;

  // /{campaignId}/player/create
  if (parts.length === 3 && parts[1] === 'player' && parts[2] === 'create') {
    return <PlayerCreatePage campaignId={parts[0]!} />;
  }

  // /{campaignId}/game
  if (parts.length === 2 && parts[1] === 'game') {
    return <GamePage campaignId={parts[0]!} />;
  }

  // /{campaignId}/lobby
  if (parts.length === 2 && parts[1] === 'lobby') {
    return <GameLobbyPage campaignId={parts[0]!} />;
  }

  // /{campaignId}/game-settings
  if (parts.length === 2 && parts[1] === 'game-settings') {
    return <GameSettingsPage campaignId={parts[0]!} />;
  }

  return <HomePage />;
}
