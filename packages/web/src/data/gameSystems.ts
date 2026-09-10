export interface GameSystem {
  id: string;
  name: string;
  edition: string;
  status: 'supported' | 'coming-soon';
  description: string;
  features: string[];
}

// One entry today (D&D 2024) — the systems page and any future system-picker render from
// this list, so adding a new ruleset is one array entry, not a page rewrite.
export const GAME_SYSTEMS: GameSystem[] = [
  {
    id: 'dnd-2024',
    name: 'Dungeons & Dragons',
    edition: '5th Edition · 2024 Rules',
    status: 'supported',
    description: 'The full 2024 ruleset, run by an AI Dungeon Master that narrates, adjudicates, and keeps the table moving.',
    features: [
      'Full character creation — species, background, class, spells, and starting gear',
      'Live combat with initiative, conditions, and 2024 action economy',
      'Dynamic dungeons generated and scaled to your party',
      'Spellcasting and concentration tracked automatically',
    ],
  },
];
