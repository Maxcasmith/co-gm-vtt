import type { ReactNode } from 'react';
import CharacterSheet from './CharacterSheet.tsx';

export default function CreationLayout({ children }: { children: ReactNode }) {
  return (
    <div className="player-info-layout">
      <div className="tab-content">{children}</div>
      <CharacterSheet />
    </div>
  );
}
