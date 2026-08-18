interface Props {
  visible: boolean;
  generating: boolean;
}

// Reuses EncounterLoadingOverlay's CSS (encounter-loading.css) — same full-screen spinner
// treatment, just a different message and no delayed-dismiss sequencing (visible is driven
// directly by useDungeonReady, no need to animate a hold-then-fade).
export default function DungeonLoadingOverlay({ visible, generating }: Props) {
  if (!visible) return null;
  return (
    <div className="encounter-overlay">
      <div className="encounter-overlay-content">
        <div className="encounter-spinner" />
        <p className="encounter-stage">{generating ? 'Generating dungeon…' : 'Loading dungeon…'}</p>
      </div>
    </div>
  );
}
