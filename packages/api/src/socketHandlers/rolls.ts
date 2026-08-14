import type { CharacterStats } from 'shared';
import { statMod } from 'shared';
import { getCharacter, appendChatLog } from '../storage.ts';
import { io, ROOM, STAT_FULL, BG_SKILLS, SAVE_PROFS } from '../state.ts';
import { D20Roll } from '../combat/dice.ts';
import { rollModeFor } from '../combat/conditions/rollModeFor.ts';
import { checkDungeonHiddenReveal } from '../dungeon/runtime.ts';
import { dispatchDMResponse } from '../session.ts';
import type { JoinContext } from './context.ts';

export function registerRollHandlers(ctx: JoinContext): void {
  const { socket } = ctx;

  socket.on('roll:check', ({ campaignId, characterId, stat, skill }) => {
    void (async () => {
      const char = await getCharacter(campaignId, characterId);
      if (!char) return;
      const statKey = stat as keyof CharacterStats;
      const base = statMod(char.stats[statKey]);
      const proficient = skill ? (
        (char.skillProficiencies ?? []).includes(skill) ||
        (BG_SKILLS[char.background] ?? []).includes(skill)
      ) : false;
      const expert = proficient && Boolean(skill) && (char.expertiseSkills ?? []).includes(skill!);
      const modifier = base + (expert ? 4 : proficient ? 2 : 0);
      const mode = rollModeFor(char, 'check', statKey);
      const roll = new D20Roll({ withDisadvantage: mode < 0, withAdvantage: mode > 0 }).roll();
      const total = roll + modifier;
      const label = skill ?? (STAT_FULL[stat.toUpperCase()] ?? stat.toUpperCase());
      console.log(`[roll] ${char.name} rolls ${label}: ${total} | proficient=${proficient}`);
      const checkResult = { characterName: char.name, rollType: 'check' as const, stat: stat.toUpperCase(), d20: roll, modifier, total, description: `${char.name} rolls ${label}: ${total}` };
      await appendChatLog(campaignId, { text: checkResult.description, senderName: 'System', timestamp: Date.now() });
      io.to(ROOM).emit('roll:result', checkResult);
      if (skill && /^(perception|investigation)$/i.test(skill)) {
        const note = await checkDungeonHiddenReveal(campaignId, char.name, total);
        if (note) await appendChatLog(campaignId, { text: note, senderName: 'System', timestamp: Date.now() });
      }
      dispatchDMResponse(campaignId);
    })();
  });

  socket.on('roll:save', ({ campaignId, characterId, stat }) => {
    void (async () => {
      const char = await getCharacter(campaignId, characterId);
      if (!char) return;
      const statKey = stat as keyof CharacterStats;
      const statUpper = stat.toUpperCase();
      const base = statMod(char.stats[statKey]);
      const proficient = (SAVE_PROFS[char.class] ?? []).includes(statUpper);
      const modifier = base + (proficient ? 2 : 0);
      const mode = rollModeFor(char, 'save', statKey);
      const roll = new D20Roll({ withDisadvantage: mode < 0, withAdvantage: mode > 0 }).roll();
      const total = roll + modifier;
      const statLabel = STAT_FULL[statUpper] ?? statUpper;
      console.log(`[roll] ${char.name} rolls ${statLabel} Save: ${total}`);
      const saveResult = { characterName: char.name, rollType: 'save' as const, stat: statUpper, d20: roll, modifier, total, description: `${char.name} rolls ${statLabel} Save: ${total}` };
      await appendChatLog(campaignId, { text: saveResult.description, senderName: 'System', timestamp: Date.now() });
      io.to(ROOM).emit('roll:result', saveResult);
      dispatchDMResponse(campaignId);
    })();
  });
}
