import { } from '../../storage.ts';
import { io, campaignRoom, fightOf, toFightOf, getStateEngine } from '../../state.ts';
import { fmtMod } from '../dice.ts';
import { removeCondition } from '../conditions/rollModeFor.ts';
import { rollSavingThrow, emitCombatRoll } from './rolls.ts';
import { applyCondition, conditionsHolder } from './statusEffects.ts';
import { postChat } from '../../partyGroups.ts';

/** Ends whatever targetId is concentrating on — tears down its linked hooks. No-op if not concentrating. */
export async function breakConcentration(cid: string, targetId: string): Promise<void> {
  const holder = await conditionsHolder(cid, targetId);
  const link = holder?.conditions?.find(c => c.name === 'Concentrating')?.concentration;
  if (!holder || !link) return;

  const engine = getStateEngine(cid);
  for (const ownerId of link.targetIds) engine.unregisterBySource(ownerId, link.spellName);
  const conditions = removeCondition(holder.conditions, 'Concentrating');
  holder.write(conditions);
  // Unlike setCondition's other callers (applyCondition/removeConditionByName), this wrote
  // directly via holder.write and skipped the broadcast — the client's own copy of `conditions`
  // (character.conditions, what the Spells tab's free-recast check reads) never found out
  // concentration ended, so a caster who wanted to redirect Hex/Hunter's Mark to a new target for
  // free (RAW: no slot spent while already concentrating) saw the Cast button disabled once their
  // one spell slot was gone, even though the server would have let the redirect through free.
  io.to(campaignRoom(cid)).emit('character:condition:update', { targetId, conditions });

  const marks = fightOf(cid, targetId)?.marks;
  const mark = marks?.get(targetId);
  if (marks && mark) {
    marks.delete(targetId);
    toFightOf(cid, targetId).emit('combat:mark', { casterId: targetId, targetId: mark.targetId, targetName: mark.targetName, spellName: mark.spellName, active: false });
  }

  console.log(`[concentration] ${holder.label} loses concentration on ${link.spellName}`);
  const msg = { text: `${holder.label} loses concentration on ${link.spellName}.`, senderName: 'System', timestamp: Date.now() };
  void postChat(cid, msg, [targetId]);
  toFightOf(cid, targetId).emit('combat:concentration', { targetId, targetName: holder.label, spellName: null });
}

/** True when casterId is currently concentrating on exactly spellName — gates free recasts (Hunter's Mark, Witch Bolt). */
export async function isConcentratingOn(cid: string, casterId: string, spellName: string): Promise<boolean> {
  const holder = await conditionsHolder(cid, casterId);
  return holder?.conditions?.find(c => c.name === 'Concentrating')?.concentration?.spellName === spellName;
}

/**
 * Starts casterId concentrating on spellName, sustained via hooks registered on hookedTargetIds.
 * 2024 rules: casting another concentration spell ends the previous one automatically, no choice
 * — so any existing concentration is broken first rather than stacking or being rejected.
 */
export async function startConcentrating(
  cid: string, casterId: string, spellName: string, hookedTargetIds: string[],
): Promise<void> {
  await breakConcentration(cid, casterId);
  const holder = await conditionsHolder(cid, casterId);
  if (!holder) return;
  const withoutOld = removeCondition(holder.conditions, 'Concentrating');
  const conditions = [...withoutOld, { name: 'Concentrating' as const, concentration: { spellName, targetIds: hookedTargetIds } }];
  holder.write(conditions);
  console.log(`[concentration] ${holder.label} begins concentrating on ${spellName}`);
  io.to(campaignRoom(cid)).emit('character:condition:update', { targetId: casterId, conditions });
  toFightOf(cid, casterId).emit('combat:concentration', { targetId: casterId, targetName: holder.label, spellName });
}

const CONCENTRATION_MIN_DC = 10;

/**
 * Called after damage lands on targetId — if they're concentrating, rolls the Constitution save
 * 5e requires (DC 10 or half the damage taken, whichever is higher) and breaks concentration on a fail.
 */
export async function checkConcentration(cid: string, targetId: string, damage: number): Promise<void> {
  const holder = await conditionsHolder(cid, targetId);
  const link = holder?.conditions?.find(c => c.name === 'Concentrating')?.concentration;
  if (!holder || !link) return;

  const dc = Math.max(CONCENTRATION_MIN_DC, Math.floor(damage / 2));
  const { saved, roll, bonus, total, breakdown } = await rollSavingThrow(cid, targetId, 'con', dc, ['Concentrating']);
  console.log(`[concentration] ${holder.label} save vs DC${dc}: d20=${roll}${fmtMod(bonus)}=${total} — ${saved ? 'MAINTAINED' : 'BROKEN'}`);
  emitCombatRoll(cid, targetId, { actorName: holder.label, label: `CON save to keep concentrating on ${link.spellName}`, dc, success: saved, breakdown });
  if (!saved) await breakConcentration(cid, targetId);
}

