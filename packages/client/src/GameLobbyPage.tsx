import { useEffect, useState } from 'react';
import type { Character, ScenarioStoryboard, StoryboardQueuePayload } from 'shared';
import StoryboardOverlay from './StoryboardOverlay.tsx';
import SaveAdventureModal from './SaveAdventureModal.tsx';
import DeleteResourcesModal from './DeleteResourcesModal.tsx';
import { useAppMeta } from './AppMetaContext.tsx';
import { Button } from './components/Button/Button.tsx';
import './app.css';

interface Props { campaignId: string }

const API = `http://${window.location.hostname}:3001`;

export default function GameLobbyPage({ campaignId }: Props) {
  const { platform } = useAppMeta();
  const [campaignName, setCampaignName] = useState('');
  // Dungeon-crawl worlds get the rich scenario synopsis written before the dungeon itself (see
  // routes/campaigns.ts's dungeon-crawl branch); every other type falls back to its concept
  // description, the same text GameListings already shows on the grid card.
  const [synopsis, setSynopsis] = useState('');
  // Also dungeon-crawl only, and only present once generation finished (see generateScenarioStoryboard) —
  // its mere presence is the "was this generated" check, same as PartyMemberOverlay does for a character's own.
  const [scenarioStoryboard, setScenarioStoryboard] = useState<ScenarioStoryboard | null>(null);
  const [playingStoryboard, setPlayingStoryboard] = useState(false);
  const [party, setParty] = useState<Character[]>([]);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingAdventure, setSavingAdventure] = useState(false);
  const [deletingCampaign, setDeletingCampaign] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  function copyLobbyLink() {
    void navigator.clipboard.writeText(window.location.href);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  // The game-level password gate — null while the silent empty-password check is still in
  // flight, so nothing else in the lobby renders until we know whether one is needed.
  const [gameAuthed, setGameAuthed] = useState<boolean | null>(null);
  const [gameEntryPassword, setGameEntryPassword] = useState('');
  const [gameAuthError, setGameAuthError] = useState('');
  const [checkingGameAuth, setCheckingGameAuth] = useState(false);

  // A game with no password authenticates on an empty string server-side — try that silently
  // first so a passwordless campaign skips straight past the gate.
  async function tryGameAuth(pw: string): Promise<boolean> {
    try {
      const r = await fetch(`${API}/api/campaigns/${campaignId}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      const data = await r.json() as { ok?: boolean; error?: string };
      const ok = r.ok && !data.error;
      setGameAuthed(ok);
      if (ok && pw) sessionStorage.setItem(`vtt-game-password:${campaignId}`, pw);
      return ok;
    } catch {
      setGameAuthed(false);
      return false;
    }
  }

  async function handleGameAuth() {
    setCheckingGameAuth(true);
    setGameAuthError('');
    const ok = await tryGameAuth(gameEntryPassword);
    if (!ok) setGameAuthError('Invalid password');
    setCheckingGameAuth(false);
  }

  useEffect(() => {
    const remembered = sessionStorage.getItem(`vtt-game-password:${campaignId}`) ?? '';
    void tryGameAuth(remembered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  useEffect(() => {
    fetch(`${API}/api/campaigns/${campaignId}`)
      .then(r => r.json())
      .then((c: { name?: string; scenarioSynopsis?: string; concept?: { name: string; description: string } }) => {
        setCampaignName(c.name ?? campaignId);
        setSynopsis(c.scenarioSynopsis ?? c.concept?.description ?? '');
      })
      .catch(() => setCampaignName(campaignId));
    fetch(`${API}/api/campaigns/${campaignId}/party`)
      .then(r => r.json())
      .then((chars: Character[]) => setParty(chars))
      .catch(() => {});
    fetch(`${API}/api/campaigns/${campaignId}/scenario-storyboard`)
      .then(r => (r.ok ? r.json() : null))
      .then((data: ScenarioStoryboard | null) => setScenarioStoryboard(data))
      .catch(() => {});

    const store = JSON.parse(localStorage.getItem('vtt-passwords') ?? '{}') as Record<string, string>;
    const saved = Object.entries(store).find(([k]) => k.startsWith(`${campaignId}:`));
    if (saved) setPassword(saved[1]);
  }, [campaignId]);

  async function handleJoin() {
    if (!password || loading) return;
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/campaigns/${campaignId}/party/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await r.json() as Character & { error?: string };
      if (!r.ok || data.error) { alert(data.error ?? 'Invalid password'); return; }
      sessionStorage.setItem(`vtt-session:${campaignId}`, JSON.stringify(data));
      window.location.href = `/${campaignId}/game`;
    } catch {
      alert('Could not connect to server');
    } finally {
      setLoading(false);
    }
  }

  if (gameAuthed === null) return null;

  if (!gameAuthed) {
    return (
      <div className="auth-gate">
        <div className="auth-gate-card">
          <h1 className="auth-gate-title">This Game is Locked</h1>
          <p className="auth-gate-sub">Enter the game password to continue.</p>
          <label className="modal-label">
            Game Password
            <input
              className="modal-input"
              type="password"
              value={gameEntryPassword}
              onChange={e => setGameEntryPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleGameAuth(); }}
              placeholder="Game password"
              autoFocus
            />
          </label>
          {gameAuthError && <p className="modal-error">{gameAuthError}</p>}
          <div className="auth-gate-actions">
            <Button variant="outline" color="secondary" navigate="/">&larr; Back to Game List</Button>
            <Button onClick={() => void handleGameAuth()} disabled={checkingGameAuth}>
              {checkingGameAuth ? 'Checking…' : 'Enter'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (playingStoryboard && scenarioStoryboard) {
    const queue: StoryboardQueuePayload = {
      entries: [{ characterId: 'scenario', characterName: '', slides: scenarioStoryboard.slides }],
    };
    return <StoryboardOverlay queue={queue} onDone={() => setPlayingStoryboard(false)} />;
  }

  return (
    <div className="home">
      <div className="home-atmosphere" aria-hidden="true" />
      <div className="game-settings-page">
        <div className="settings-sidebar-header">
          <Button variant="outline" color="secondary" navigate="/">&larr; Back</Button>
          <h2 className="settings-title">{campaignName}</h2>
        </div>

        <div className="settings-body">
          {synopsis && <p className="lobby-synopsis">{synopsis}</p>}
          {scenarioStoryboard && (
            <Button variant="outline" className="lobby-synopsis-play" onClick={() => setPlayingStoryboard(true)}>▶ Play Storyboard</Button>
          )}
          {party.length === 0 && (
            <p className="party-empty">There are currently no adventurers in the party.</p>
          )}
          {party.length > 0 && (
            <ul className="party-list">
              {party.map(char => (
                <li key={char.id} className="party-list-item">
                  <div className="party-list-portrait">
                    {char.portraitPath
                      ? <img src={`${API}/api/campaigns/${char.campaignId}/party/${char.id}/portrait`} alt={char.name} />
                      : <span>{char.name[0]?.toUpperCase()}</span>
                    }
                  </div>
                  <span className="party-list-name">{char.name}</span>
                  {char.class && <span className="party-list-meta">{char.species} {char.class}</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="modal-form">
            <label className="modal-label">
              Character Password
              <input
                className="modal-input"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleJoin(); }}
                placeholder="Your character password"
              />
            </label>
          </div>
        </div>

        <div className="modal-actions modal-actions--split settings-footer">
          <Button variant="ghost" className="btn-create-player-link" navigate={`/${campaignId}/player/create`}>
            Create a character
          </Button>
          <div className="modal-action-btns">
            <Button variant="outline" color="secondary" onClick={copyLobbyLink}>{linkCopied ? '✓ Copied' : '🔗 Copy Link'}</Button>
            <Button variant="outline" color="secondary" navigate={`/${campaignId}/game-settings`}>Game Settings</Button>
            <Button onClick={() => void handleJoin()} disabled={!password || loading}>Join</Button>
          </div>
        </div>
      </div>
      <div className="lobby-save-adventure">
        <Button variant="outline" color="secondary" onClick={() => setSavingAdventure(true)}>Save Adventure</Button>
      </div>
      {platform === 'web' && (
        <Button variant="outline" color="danger" className="lobby-delete-campaign" onClick={() => setDeletingCampaign(true)}>Delete Game</Button>
      )}
      <SaveAdventureModal
        open={savingAdventure}
        campaign={{ id: campaignId, name: campaignName }}
        onClose={() => setSavingAdventure(false)}
        onSaved={() => {}}
      />
      <DeleteResourcesModal
        open={deletingCampaign}
        name={campaignName}
        deleteUrl={`/api/campaigns/${campaignId}`}
        onClose={() => setDeletingCampaign(false)}
        onDeleted={() => { window.location.href = '/'; }}
      />
    </div>
  );
}
