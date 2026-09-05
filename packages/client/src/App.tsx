import HomePage from './HomePage.tsx';
import CreateCampaignPage from './create-campaign/CreateCampaignPage.tsx';
import SavedAdventuresPage from './SavedAdventuresPage.tsx';
import GamePage from './GamePage.tsx';
import GameLobbyPage from './GameLobbyPage.tsx';
import PlayerCreatePage from './PlayerCreatePage.tsx';
import GameSettingsPage from './GameSettingsPage.tsx';
import AdminLayout, { type AdminTab } from './AdminLayout.tsx';
import LicenseGate from './LicenseGate.tsx';
import { AppMetaProvider } from './AppMetaContext.tsx';

const ADMIN_TABS: AdminTab[] = ['campaigns', 'modules', 'tiles', 'props', 'icons', 'items', 'bestiary', 'storyboard', 'plot-hooks'];

export default function App() {
  const parts = window.location.pathname.split('/').filter(Boolean);

  return <AppMetaProvider><LicenseGate>{renderRoute(parts)}</LicenseGate></AppMetaProvider>;
}

function renderRoute(parts: string[]) {
  if (parts[0] === 'admin') {
    const requested = parts[1] as AdminTab | undefined;
    const initialTab = requested && ADMIN_TABS.includes(requested) ? requested : 'home';
    return <AdminLayout initialTab={initialTab} />;
  }

  if (parts[0] === 'create') return <CreateCampaignPage />;

  if (parts[0] === 'saved-adventures') return <SavedAdventuresPage />;

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
