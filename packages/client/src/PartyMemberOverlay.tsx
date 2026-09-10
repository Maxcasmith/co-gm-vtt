import { useEffect, useState } from 'react';
import type { Character, CharacterStoryboard, StoryboardQueuePayload } from 'shared';
import { API, mod } from './characterSheet/helpers.tsx';
import { Button } from './components/Button/Button.tsx';
import { STAT_NAMES } from './character-creation/srd.ts';
import StoryboardOverlay from './StoryboardOverlay.tsx';

interface Props {
  characterId: string | null;
  campaignId: string;
  onClose: () => void;
}

const STAT_KEYS: Array<keyof Character['stats']> = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

// Read-only view of a teammate's sheet — reuses the CharacterSheetOverlay panel classes since it's
// the same information at a glance, just not editable. "Play Backstory" is client-local only (no
// socket emit anywhere in this component), so it's visible to whoever clicked it and no one else.
export default function PartyMemberOverlay({ characterId, campaignId, onClose }: Props) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [storyboard, setStoryboard] = useState<CharacterStoryboard | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!characterId) { setCharacter(null); setStoryboard(null); return; }
    setPlaying(false);
    setCharacter(null);
    setStoryboard(null);
    fetch(`${API}/api/campaigns/${campaignId}/party/${characterId}`)
      .then(r => r.json())
      .then((c: Character) => setCharacter(c))
      .catch(() => {});
    fetch(`${API}/api/campaigns/${campaignId}/party/${characterId}/storyboard`)
      .then(r => (r.ok ? r.json() : null))
      .then((data: CharacterStoryboard | null) => setStoryboard(data))
      .catch(() => {});
  }, [characterId, campaignId]);

  if (!characterId || !character) return null;

  if (playing && storyboard) {
    const queue: StoryboardQueuePayload = {
      entries: [{ characterId: character.id, characterName: character.name, slides: storyboard.slides }],
    };
    return <StoryboardOverlay queue={queue} onDone={() => setPlaying(false)} />;
  }

  const portraitCharId = character.portraitPath ? (character.portraitPath.split('/')[1] ?? character.id) : character.id;
  const portraitUrl = character.portraitPath ? `${API}/api/campaigns/${campaignId}/party/${portraitCharId}/portrait` : null;

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()}>
        <div className="sheet-topbar">
          {portraitUrl
            ? <img className="sheet-portrait" src={portraitUrl} alt={character.name} />
            : <div className="sheet-portrait-placeholder" />}
          <div className="sheet-identity">
            <p className="sheet-name">{character.name}</p>
            <p className="sheet-subtitle">
              Level {character.level ?? 1} {character.class} · {character.species} · {character.background}
            </p>
          </div>
          {storyboard && (
            <Button variant="outline" onClick={() => setPlaying(true)}>▶ Play Backstory</Button>
          )}
          <Button variant="outline" color="secondary" className="sheet-close" onClick={onClose} aria-label="Close">×</Button>
        </div>

        <div className="sheet-content">
          <div className="sheet-stats">
            {STAT_KEYS.map((key, i) => (
              <div key={key} className="stat-card">
                <div className="stat-card-name">{STAT_NAMES[i]}</div>
                <div className="stat-card-score">{character.stats[key]}</div>
                <div className="stat-card-mod">{mod(character.stats[key])}</div>
              </div>
            ))}
          </div>

          <div className="sheet-feature-group">
            <p className="sheet-feature-group-title">Backstory</p>
            <p className="sheet-backstory-text">{character.backstory?.trim() || 'No backstory recorded.'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
