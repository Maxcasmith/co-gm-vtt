import { createContext, useContext, useState, type ReactNode } from 'react';
import type { CharacterStats, InventoryItem } from 'shared';
import { STANDARD_ARRAY, type StatName } from './srd.ts';

export type AttributeMethod = 'roll' | 'pointBuy' | 'standardArray';

interface CharacterDraft {
  id: string;
  name: string;
  password: string;
  species: string;
  subspecies: string;
  draconicAncestry: string; // Dragonborn only — dragon within the lineage (Red, Silver, ...)
  speciesOriginFeat: string;
  background: string;
  backgroundAsi: Partial<Record<StatName, number>>;
  characterClass: string;
  skillProficiencies: Record<string, string>; // skill name → source label
  stats: number[];       // 6 slots, 0 = unassigned — Dice Roll tab's assignment
  pool: number[];        // rolled values not yet placed
  rolled: boolean;
  rerollUsed: boolean;
  attributeMethod: AttributeMethod;
  pointBuyStats: number[];      // 6 slots, each 8-15
  standardArrayStats: number[]; // 6 slots, 0 = unassigned
  standardArrayPool: number[];  // STANDARD_ARRAY values not yet placed
  portraitBase64: string;
  portraitPath: string;
  tokenPath: string;
  expertiseSkills: string[];
  fightingStyle: string;
  classOrder: string;
  invocations: string[];
  activeTab: 'profile' | 'class' | 'classFeatures' | 'species' | 'attributes' | 'spells' | 'shop' | 'backstory' | 'finished';
  gold: number;
  inventory: InventoryItem[];
  learnedSpells: Record<string, string>; // spell name → source label (class name or feat name)
  backstory: string;
  aiConcept: string;
  aiConceptSuggestions: ConceptSuggestions | null;
}

export interface ConceptOption {
  class: string;
  species: string;
  subspecies: string | null;
  skills: string[];
  spells: string[];
  reason: string;
}

export interface ConceptSuggestions {
  summary: string;
  options: ConceptOption[];
}

interface CharacterContextValue extends CharacterDraft {
  set: <K extends keyof CharacterDraft>(key: K, value: CharacterDraft[K]) => void;
  isDirty: boolean;
  toStats: () => CharacterStats;
  activeStats: number[];
  attributesComplete: boolean;
}

const CharacterContext = createContext<CharacterContextValue | null>(null);

export function useCharacter(): CharacterContextValue {
  const ctx = useContext(CharacterContext);
  if (!ctx) throw new Error('useCharacter must be used inside CharacterProvider');
  return ctx;
}

const BLANK: Omit<CharacterDraft, 'id'> = {
  name: '', password: '',
  species: '', subspecies: '', draconicAncestry: '', speciesOriginFeat: '',
  background: '', backgroundAsi: {},
  characterClass: '', skillProficiencies: {},
  stats: [0, 0, 0, 0, 0, 0], pool: [], rolled: false, rerollUsed: false,
  attributeMethod: 'roll',
  pointBuyStats: [8, 8, 8, 8, 8, 8],
  standardArrayStats: [0, 0, 0, 0, 0, 0],
  standardArrayPool: [...STANDARD_ARRAY],
  portraitBase64: '', portraitPath: '', tokenPath: '',
  expertiseSkills: [],
  fightingStyle: '',
  classOrder: '',
  invocations: [],
  activeTab: 'profile',
  gold: 200,
  inventory: [],
  learnedSpells: {},
  backstory: '',
  aiConcept: '',
  aiConceptSuggestions: null,
};

const STAT_IDX: Record<StatName, number> = { STR: 0, DEX: 1, CON: 2, INT: 3, WIS: 4, CHA: 5 };

export function CharacterProvider({ children, id, initialAttributeMethod }: { children: ReactNode; id: string; initialAttributeMethod?: AttributeMethod }) {
  const [draft, setDraft] = useState<CharacterDraft>({ ...BLANK, id, attributeMethod: initialAttributeMethod ?? BLANK.attributeMethod });

  function set<K extends keyof CharacterDraft>(key: K, value: CharacterDraft[K]) {
    setDraft(d => ({ ...d, [key]: value }));
  }

  const isDirty = draft.name !== '' || draft.rolled || draft.portraitBase64 !== '';

  const activeStats =
    draft.attributeMethod === 'pointBuy' ? draft.pointBuyStats
    : draft.attributeMethod === 'standardArray' ? draft.standardArrayStats
    : draft.stats;

  const attributesComplete =
    draft.attributeMethod === 'pointBuy' ? true
    : draft.attributeMethod === 'standardArray' ? draft.standardArrayPool.length === 0
    : draft.rolled && draft.pool.length === 0;

  function toStats(): CharacterStats {
    const base = [...activeStats];
    const result = [0, 0, 0, 0, 0, 0].map((_, i) => (base[i] ?? 0) + (draft.backgroundAsi[(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as StatName[])[i]] ?? 0));
    const [str = 0, dex = 0, con = 0, int = 0, wis = 0, cha = 0] = result;
    return { str, dex, con, int, wis, cha };
  }

  return (
    <CharacterContext.Provider value={{ ...draft, set, isDirty, toStats, activeStats, attributesComplete }}>
      {children}
    </CharacterContext.Provider>
  );
}
