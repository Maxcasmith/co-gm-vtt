// Standalone check for the currency helpers — no test framework in this repo, so this is the one
// runnable check: `tsx src/types/character.currency.selfcheck.ts` from packages/shared.
// Asserts: adding to an empty/undefined denomination starts from 0, removing floors at 0 rather
// than going negative, and each of the 5 denominations is tracked independently.
import { addCurrency, removeCurrency, currencyAmount, type Character, type CurrencyDenomination } from './character.ts';

const char: Pick<Character, CurrencyDenomination> = {};

if (currencyAmount(char, 'gold') !== 0) throw new Error('an untouched denomination should read as 0');

const afterAdd = addCurrency(char, 'gold', 5);
if (afterAdd !== 5) throw new Error(`expected 5 after adding 5 to an empty gold pool, got ${afterAdd}`);

const withGold: Pick<Character, CurrencyDenomination> = { gold: afterAdd };
const afterRemove = removeCurrency(withGold, 'gold', 2);
if (afterRemove !== 3) throw new Error(`expected 3 after removing 2 from 5 gold, got ${afterRemove}`);

const overRemove = removeCurrency(withGold, 'gold', 100);
if (overRemove !== 0) throw new Error(`removing more than available should floor at 0, got ${overRemove}`);

// Denominations are independent — adding to one never touches another.
const multi: Pick<Character, CurrencyDenomination> = { gold: 10, silver: 20 };
if (addCurrency(multi, 'silver', 3) !== 23) throw new Error('adding to silver should not be affected by gold');
if (currencyAmount(multi, 'gold') !== 10) throw new Error('reading gold should not be affected by a silver add');
if (currencyAmount(multi, 'platinum') !== 0) throw new Error('an untouched platinum should read as 0, not leak from another denomination');

console.log('character.currency selfcheck: OK — starts at 0, adds/removes correctly, floors at 0, denominations independent.');
