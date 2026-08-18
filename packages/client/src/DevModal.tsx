import { useState } from 'react';
import { setLightingEnabled, isLightingEnabled, setDarkvisionEnabled, isDarkvisionEnabled } from './canvas/lighting.ts';
import { togglePerfOverlay, isPerfOverlayEnabled } from './canvas/drawScene.ts';
import { dispatch } from './events.ts';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function DevModal({ open, onClose }: Props) {
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
          <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
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
          <button
            className={`settings-toggle ${lighting ? 'settings-toggle--on' : ''}`}
            onClick={toggleLighting}
            aria-pressed={lighting}
          >
            <span className="settings-toggle-thumb" />
          </button>
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
          <button
            className={`settings-toggle ${darkvision ? 'settings-toggle--on' : ''}`}
            onClick={toggleDarkvision}
            aria-pressed={darkvision}
          >
            <span className="settings-toggle-thumb" />
          </button>
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
          <button
            className={`settings-toggle ${perfOverlay ? 'settings-toggle--on' : ''}`}
            onClick={toggleDrawData}
            aria-pressed={perfOverlay}
          >
            <span className="settings-toggle-thumb" />
          </button>
        </div>
      </div>
    </div>
  );
}
