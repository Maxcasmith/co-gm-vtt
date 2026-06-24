import { createContext, useContext, useState, type ReactNode } from 'react';
import type { CharacterStats, InventoryItem } from 'shared';
import type { StatName } from './srd.ts';

interface CharacterDraft {
  id: string;
  name: string;
  password: string;
  species: string;
  subspecies: string;
  speciesOriginFeat: string;
  background: string;
  backgroundAsi: Partial<Record<StatName, number>>;
  characterClass: string;
  skillProficiencies: Record<string, string>; // skill name → source label
  stats: number[];       // 6 slots, 0 = unassigned
  pool: number[];        // rolled values not yet placed
  rolled: boolean;
  rerollUsed: boolean;
  portraitBase64: string;
  portraitPath: string;
  tokenPath: string;
  expertiseSkills: string[];
  activeTab: 'info' | 'spells' | 'shop';
  gold: number;
  inventory: InventoryItem[];
}

interface CharacterContextValue extends CharacterDraft {
  set: <K extends keyof CharacterDraft>(key: K, value: CharacterDraft[K]) => void;
  isDirty: boolean;
  toStats: () => CharacterStats;
}

const CharacterContext = createContext<CharacterContextValue | null>(null);

export function useCharacter(): CharacterContextValue {
  const ctx = useContext(CharacterContext);
  if (!ctx) throw new Error('useCharacter must be used inside CharacterProvider');
  return ctx;
}

const BLANK: Omit<CharacterDraft, 'id'> = {
  name: '', password: '',
  species: '', subspecies: '', speciesOriginFeat: '',
  background: '', backgroundAsi: {},
  characterClass: '', skillProficiencies: {},
  stats: [0, 0, 0, 0, 0, 0], pool: [], rolled: false, rerollUsed: false,
  portraitBase64: '', portraitPath: '', tokenPath: '',
  expertiseSkills: [],
  activeTab: 'info',
  gold: 200,
  inventory: [],
};

const STAT_IDX: Record<StatName, number> = { STR: 0, DEX: 1, CON: 2, INT: 3, WIS: 4, CHA: 5 };

export function CharacterProvider({ children, id }: { children: ReactNode; id: string }) {
  const [draft, setDraft] = useState<CharacterDraft>({ ...BLANK, id });

  function set<K extends keyof CharacterDraft>(key: K, value: CharacterDraft[K]) {
    setDraft(d => ({ ...d, [key]: value }));
  }

  const isDirty = draft.name !== '' || draft.rolled || draft.portraitBase64 !== '';

  function toStats(): CharacterStats {
    const base = [...draft.stats];
    const result = [0, 0, 0, 0, 0, 0].map((_, i) => (base[i] ?? 0) + (draft.backgroundAsi[(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as StatName[])[i]] ?? 0));
    const [str = 0, dex = 0, con = 0, int = 0, wis = 0, cha = 0] = result;
    return { str, dex, con, int, wis, cha };
  }

  return (
    <CharacterContext.Provider value={{ ...draft, set, isDirty, toStats }}>
      {children}
    </CharacterContext.Provider>
  );
}
