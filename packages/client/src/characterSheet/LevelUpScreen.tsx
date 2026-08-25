import type { Character } from "shared";

interface Props {
  character: Character;
  fromLevel: number;
  toLevel: number;
  onConfirm: () => void;
  onClose: () => void;
}

// Base level-up screen: swapped in over the sheet the same way CharacterSheetOverlay swaps in
// StoryboardOverlay for playingBackstory. Sections below are placeholders — HP roll, class
// features, ASI/feat choice, spell selection all land here later.
export function LevelUpScreen({ character, fromLevel, toLevel, onConfirm, onClose }: Props) {
  return (
    <div className="sheet-scrim">
      <div className="sheet-panel level-up-panel">
        <div className="sheet-topbar">
          <div className="sheet-identity">
            <p className="sheet-name">Level Up</p>
            <p className="sheet-subtitle">
              {character.name} · {character.class} · Level {fromLevel} → {toLevel}
            </p>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="sheet-content level-up-content">
          <div className="level-up-section">
            <p className="level-up-section-title">Hit Points</p>
            <p className="level-up-placeholder">Coming soon</p>
          </div>
          <div className="level-up-section">
            <p className="level-up-section-title">Class Features</p>
            <p className="level-up-placeholder">Coming soon</p>
          </div>
          <div className="level-up-section">
            <p className="level-up-section-title">Ability Score Improvement</p>
            <p className="level-up-placeholder">Coming soon</p>
          </div>
        </div>

        <div className="level-up-actions">
          <button className="sheet-rest-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="sheet-levelup-btn sheet-levelup-btn--ready" onClick={onConfirm}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
