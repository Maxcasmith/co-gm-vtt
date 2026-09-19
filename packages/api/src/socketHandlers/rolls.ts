import type { CharacterStats } from 'shared';
import { statMod } from 'shared';
import { getCharacter, appendChatLog } from '../storage.ts';
import { trySpendLuckForAdvantage, trySpendHeroicInspiration } from '../combat/runtime/resources.ts';
import { io, ROOM, STAT_FULL, BG_SKILLS, SAVE_PROFS, getStateEngine, combatState } from '../state.ts';
import { D20Roll } from '../combat/dice.ts';
import { rollModeFor } from '../combat/conditions/rollModeFor.ts';
import { checkDungeonHiddenReveal } from '../dungeon/runtime.ts';
import { templateSearchResult } from '../dungeon/narrateEvents.ts';
import { dispatchDMResponse } from '../session.ts';
import { resolveSpellCast } from '../effects.ts';
import type { JoinContext } from './context.ts';
import { sumAndConsumeRollMods, type RollModifierHook } from '../combat/stateEngine/hooks/RollModifierHook.ts';

export function registerRollHandlers(ctx: JoinContext): void {
  const { socket } = ctx;

  socket.on('roll:check', ({ campaignId, characterId, stat, skill, useLuckPoint, useInspiration }) => {
    void (async () => {
      const char = await getCharacter(campaignId, characterId);
      if (!char) return;
      const luckSpent = await trySpendLuckForAdvantage(campaignId, characterId, char, useLuckPoint);
      const inspirationSpent = await trySpendHeroicInspiration(campaignId, characterId, char, useInspiration);
      const statKey = stat as keyof CharacterStats;
      const base = statMod(char.stats[statKey]);
      const proficient = skill ? (
        (char.skillProficiencies ?? []).includes(skill) ||
        (BG_SKILLS[char.background] ?? []).includes(skill)
      ) : false;
      const expert = proficient && Boolean(skill) && (char.expertiseSkills ?? []).includes(skill!);
      const engine = getStateEngine(campaignId);
      // Guidance — rerolled fresh against every check, not fixed at cast time (see RollModifierHook),
      // scoped to the one named skill it bonuses. Bardic Inspiration registers unscoped ('rollModifier',
      // the same kind Bless/Bane use) since its die applies to ANY d20 Test — attack roll, save, or
      // check, any skill — and is consumeOnUse, spent the moment it's summed into a roll here.
      const skillMods = skill
        ? (engine.getHooksOwnedBy(characterId, 'rollModifierCheck') as RollModifierHook[]).filter(h => h.skill === skill)
        : [];
      const unscopedMods = engine.getHooksOwnedBy(characterId, 'rollModifier') as RollModifierHook[];
      const skillBonus = sumAndConsumeRollMods(engine, [...skillMods, ...unscopedMods]);
      const modifier = base + (expert ? 4 : proficient ? 2 : 0) + skillBonus;
      const mode = rollModeFor(char, 'check', statKey);
      const roll = new D20Roll({ withDisadvantage: mode < 0, withAdvantage: mode > 0 || luckSpent || inspirationSpent }).roll();
      const total = roll + modifier;
      const label = skill ?? (STAT_FULL[stat.toUpperCase()] ?? stat.toUpperCase());
      console.log(`[roll] ${char.name} rolls ${label}: ${total} | proficient=${proficient}`);
      const checkResult = { characterName: char.name, rollType: 'check' as const, stat: stat.toUpperCase(), d20: roll, modifier, total, description: `${char.name} rolls ${label}: ${total}` };
      await appendChatLog(campaignId, { text: checkResult.description, senderName: 'System', timestamp: Date.now() });
      io.to(ROOM).emit('roll:result', checkResult);
      if (skill && /^(perception|investigation)$/i.test(skill)) {
        const finds = await checkDungeonHiddenReveal(campaignId, char.name, total);
        // A dungeon hideDC actually resolved (a hit, or a clean miss against something hidden
        // nearby) → the outcome is fully determined by the map, so template it and skip the LLM
        // entirely. null means this roll had nothing dungeon-side to resolve against, so it falls
        // through to the narrator as before — better an LLM turn than a wrong templated one.
        if (finds) {
          const text = (finds.length ? finds.map(f => templateSearchResult(char.name, f)) : [templateSearchResult(char.name, null)]).join('\n');
          const senderName = 'Virtual DM';
          await appendChatLog(campaignId, { text, senderName, timestamp: Date.now() });
          io.to(ROOM).emit('session:recap', { text, senderName, checkRequests: [] });
          return;
        }
      }
      dispatchDMResponse(campaignId);
    })();
  });

  socket.on('roll:save', ({ campaignId, characterId, stat, useLuckPoint, useInspiration }) => {
    void (async () => {
      const char = await getCharacter(campaignId, characterId);
      if (!char) return;
      const luckSpent = await trySpendLuckForAdvantage(campaignId, characterId, char, useLuckPoint);
      const inspirationSpent = await trySpendHeroicInspiration(campaignId, characterId, char, useInspiration);
      const statKey = stat as keyof CharacterStats;
      const statUpper = stat.toUpperCase();
      const base = statMod(char.stats[statKey]);
      const proficient = (SAVE_PROFS[char.class] ?? []).includes(statUpper);
      const modifier = base + (proficient ? 2 : 0);
      const mode = rollModeFor(char, 'save', statKey);
      const roll = new D20Roll({ withDisadvantage: mode < 0, withAdvantage: mode > 0 || luckSpent || inspirationSpent }).roll();
      const total = roll + modifier;
      const statLabel = STAT_FULL[statUpper] ?? statUpper;
      console.log(`[roll] ${char.name} rolls ${statLabel} Save: ${total}`);
      const saveResult = { characterName: char.name, rollType: 'save' as const, stat: statUpper, d20: roll, modifier, total, description: `${char.name} rolls ${statLabel} Save: ${total}` };
      await appendChatLog(campaignId, { text: saveResult.description, senderName: 'System', timestamp: Date.now() });
      io.to(ROOM).emit('roll:result', saveResult);
      dispatchDMResponse(campaignId);
    })();
  });

  // Exploration-mode spell cast, triggered by the journal's cast-spell control — the deliberate,
  // structured counterpart to the DM's own freeform [[CAST_SPELL:...]] tag. Both route through
  // resolveSpellCast so a UI-triggered cast and a narration-triggered one cost the same thing.
  // Combat has its own turn-based casting (combat:spell:cast) — this is exploration-only.
  socket.on('spell:cast:exploration', ({ campaignId, characterId, spellName }) => {
    void (async () => {
      if (combatState.get(campaignId)) return;
      const char = await getCharacter(campaignId, characterId);
      if (!char) return;
      const result = await resolveSpellCast(campaignId, char.name, spellName);
      if (!result.ok) return;
      const msg = { text: `${char.name} casts ${spellName}.`, senderName: 'System', timestamp: Date.now() };
      await appendChatLog(campaignId, msg);
      io.to(ROOM).emit('chat:message', msg);
      dispatchDMResponse(campaignId);
    })();
  });
}
