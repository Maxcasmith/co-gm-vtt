import { useEffect, useState } from "react";
import type { Character, CharacterStoryboard } from "shared";
import { Button } from "../components/Button/Button.tsx";
import { API } from "./helpers.tsx";

interface Props {
  character: Character;
  onPlay: (storyboard: CharacterStoryboard) => void;
}

export function InfoTab({ character, onPlay }: Props) {
  const [storyboard, setStoryboard] = useState<CharacterStoryboard | null>(null);

  useEffect(() => {
    fetch(`${API}/api/campaigns/${character.campaignId}/party/${character.id}/storyboard`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: CharacterStoryboard | null) => setStoryboard(data))
      .catch(() => setStoryboard(null));
  }, [character.campaignId, character.id]);

  return (
    <div className="sheet-feature-group">
      <div className="sheet-info-header">
        <p className="sheet-feature-group-title">Backstory</p>
        {storyboard && (
          <Button variant="outline" onClick={() => onPlay(storyboard)}>
            ▶ Play Backstory
          </Button>
        )}
      </div>
      <p className="sheet-backstory-text">
        {character.backstory?.trim() || "No backstory recorded."}
      </p>
    </div>
  );
}
