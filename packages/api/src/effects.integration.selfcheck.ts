// Integration check for resolveSpellCast and the currency_add/currency_remove effects — the two
// pieces flagged as "mechanically built but never actually run." No test framework in this repo,
// so this is the one runnable check: `tsx src/effects.integration.selfcheck.ts` from packages/api.
// Writes real character.json files under a throwaway campaign slug (never touches a real
// campaign), exercises the actual storage-backed code path (not a mock), then deletes the
// throwaway campaign directory whether the checks pass or throw.
import { deleteCampaign, writeCharacter, getCharacter } from './storage.ts';
import { resolveSpellCast, applyEffects } from './effects.ts';

const SLUG = '__selfcheck-effects__';
const CHAR_ID = 'fixture-hades';

const fixture = {
  id: CHAR_ID,
  campaignId: SLUG,
  name: 'Fixture Hades',
  species: 'Human',
  background: 'Sage',
  class: 'Wizard',
  stats: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 },
  skillProficiencies: [],
  password: 'x',
  portraitPath: '',
  tokenPath: '',
  createdAt: new Date().toISOString(),
  spells: ['Thunderwave', 'Fire Bolt'],
  currentSpellSlots1: 1,
  maxSpellSlots1: 1,
} as Parameters<typeof writeCharacter>[2];

async function main() {
  await writeCharacter(SLUG, CHAR_ID, fixture);

  // ── resolveSpellCast: a real leveled spell spends the character's one slot ──────────────────
  const first = await resolveSpellCast(SLUG, 'Fixture Hades', 'Thunderwave');
  if (!first.ok) throw new Error('first Thunderwave cast should succeed — one slot was available');
  const afterFirst = await getCharacter(SLUG, CHAR_ID);
  if (afterFirst?.currentSpellSlots1 !== 0) throw new Error(`expected currentSpellSlots1=0 after spending the only slot, got ${afterFirst?.currentSpellSlots1}`);

  // Second cast with no slots left — must be blocked, not silently allowed.
  const second = await resolveSpellCast(SLUG, 'Fixture Hades', 'Thunderwave');
  if (second.ok) throw new Error('second Thunderwave cast should be blocked — no slots remain');

  // A cantrip never touches the slot count at all.
  const cantrip = await resolveSpellCast(SLUG, 'Fixture Hades', 'Fire Bolt');
  if (!cantrip.ok) throw new Error('a cantrip cast should never be blocked by slot count');
  const afterCantrip = await getCharacter(SLUG, CHAR_ID);
  if (afterCantrip?.currentSpellSlots1 !== 0) throw new Error('a cantrip cast should not touch currentSpellSlots1');

  // An unknown character name — no character to charge, must not throw.
  const unknown = await resolveSpellCast(SLUG, 'Nobody Here', 'Thunderwave');
  if (unknown.ok) throw new Error('an unknown character name should never report a successful cast');

  // ── currency_add / currency_remove effects — write straight to the denomination field, ────
  // never to inventory.
  await applyEffects(SLUG, [{ type: 'currency_add', player: 'Fixture Hades', denom: 'silver', amount: 5 }]);
  const afterAdd = await getCharacter(SLUG, CHAR_ID);
  if (afterAdd?.silver !== 5) throw new Error(`expected silver=5 after CURRENCY_ADD, got ${afterAdd?.silver}`);
  if (afterAdd?.inventory?.length) throw new Error('a currency grant must never add an inventory item');

  await applyEffects(SLUG, [{ type: 'currency_remove', player: 'Fixture Hades', denom: 'silver', amount: 2 }]);
  const afterRemove = await getCharacter(SLUG, CHAR_ID);
  if (afterRemove?.silver !== 3) throw new Error(`expected silver=3 after removing 2, got ${afterRemove?.silver}`);

  await applyEffects(SLUG, [{ type: 'currency_remove', player: 'Fixture Hades', denom: 'silver', amount: 100 }]);
  const afterOverRemove = await getCharacter(SLUG, CHAR_ID);
  if (afterOverRemove?.silver !== 0) throw new Error(`removing more than available should floor at 0, got ${afterOverRemove?.silver}`);
}

main()
  .then(() => console.log('effects.integration selfcheck: OK — spell slot spends/blocks/cantrip-frees correctly on real storage, currency writes the denomination field directly, never inventory.'))
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => deleteCampaign(SLUG));
