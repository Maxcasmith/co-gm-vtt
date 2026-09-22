import { useState } from 'react';
import { setLightingEnabled, isLightingEnabled, setDarkvisionEnabled, isDarkvisionEnabled } from './canvas/lighting.ts';
import { togglePerfOverlay, isPerfOverlayEnabled } from './canvas/drawScene.ts';
import { dispatch } from './events.ts';
import { Button } from './components/Button/Button.tsx';

interface Props {
  open: boolean;
  onClose: () => void;
  combatLogText: boolean;
  onCombatLogTextChange: (on: boolean) => void;
}

export default function DevModal({ open, onClose, combatLogText, onCombatLogTextChange }: Props) {
  const [lighting, setLighting] = useState(isLightingEnabled());
  const [darkvision, setDarkvision] = useState(isDarkvisionEnabled());
  const [perfOverlay, setPerfOverlay] = useState(isPerfOverlayEnabled());

  if (!open) return null;

  function toggleLighting() {
    const next = !lighting;
    setLighting(next);
    setLightingEnabled(next);
    dispatch('vtt:dev:redraw', {});
  }

  function toggleDarkvision() {
    const next = !darkvision;
    setDarkvision(next);
    setDarkvisionEnabled(next);
    dispatch('vtt:dev:redraw', {});
  }

  function toggleDrawData() {
    togglePerfOverlay();
    setPerfOverlay(isPerfOverlayEnabled());
    dispatch('vtt:dev:redraw', {});
  }

  return (
    <div className="journal-scrim" onClick={onClose}>
      <div className="journal-panel" onClick={e => e.stopPropagation()}>
        <div className="journal-header">
          <h2 className="journal-title">Dev Tools</h2>
          <Button variant="outline" color="secondary" className="sheet-close" onClick={onClose} aria-label="Close">×</Button>
        </div>
        <div className="settings-toggle-row">
          <div className="settings-toggle-text">
            <span className="settings-toggle-label">Lighting</span>
            <span className="settings-toggle-desc">
              {lighting
                ? 'Dungeon illumination dims/desaturates the ground and tokens as normal.'
                : 'Map renders full-bright — illumination-based dimming/desaturation is bypassed.'}
            </span>
          </div>
          <Button
            variant="ghost"
            className={`settings-toggle ${lighting ? 'settings-toggle--on' : ''}`}
            onClick={toggleLighting}
            aria-pressed={lighting}
          >
            <span className="settings-toggle-thumb" />
          </Button>
        </div>
        <div className="settings-toggle-row">
          <div className="settings-toggle-text">
            <span className="settings-toggle-label">Darkvision</span>
            <span className="settings-toggle-desc">
              {darkvision
                ? 'Darkvision/blindsight/truesight/tremorsense render as normal in the dark.'
                : 'Sense tiers never activate — the character sees only what dungeon illumination allows.'}
            </span>
          </div>
          <Button
            variant="ghost"
            className={`settings-toggle ${darkvision ? 'settings-toggle--on' : ''}`}
            onClick={toggleDarkvision}
            aria-pressed={darkvision}
          >
            <span className="settings-toggle-thumb" />
          </Button>
        </div>
        <div className="settings-toggle-row">
          <div className="settings-toggle-text">
            <span className="settings-toggle-label">Live draw data</span>
            <span className="settings-toggle-desc">
              {perfOverlay
                ? 'Draws/sec, last draw time, and per-section timings are shown in the top-right corner.'
                : 'Perf overlay hidden.'}
            </span>
          </div>
          <Button
            variant="ghost"
            className={`settings-toggle ${perfOverlay ? 'settings-toggle--on' : ''}`}
            onClick={toggleDrawData}
            aria-pressed={perfOverlay}
          >
            <span className="settings-toggle-thumb" />
          </Button>
        </div>
        <div className="settings-toggle-row">
          <div className="settings-toggle-text">
            <span className="settings-toggle-label">Combat log text</span>
            <span className="settings-toggle-desc">
              {combatLogText
                ? 'Plain-text lines (the white text) are added to the combat log.'
                : 'Plain-text lines are skipped — only the attack and spell cards are logged.'}
            </span>
          </div>
          <Button
            variant="ghost"
            className={`settings-toggle ${combatLogText ? 'settings-toggle--on' : ''}`}
            onClick={() => onCombatLogTextChange(!combatLogText)}
            aria-pressed={combatLogText}
          >
            <span className="settings-toggle-thumb" />
          </Button>
        </div>
      </div>
    </div>
  );
}
