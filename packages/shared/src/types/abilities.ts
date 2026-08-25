import type { ActionResource, EffectSpec, HookSpec } from "./spells.ts";

/**
 * A non-spell class feature a player can trigger mid-combat (Rage, Second Wind, Bardic
 * Inspiration, ...) — the generic "use ability" action this app was missing versus spell-cast
 * and weapon-attack being the only two player-triggered mechanics that existed. Deliberately
 * reuses EffectSpec (the same shape spells' onHit uses) instead of inventing a parallel effect
 * language, so the cast pipeline's existing dice/apply helpers (rollApplicableHeal, etc.) work
 * unchanged against an ability's effects too.
 *
 * `target` says who onUse/hooks apply to: 'self' (Second Wind, Rage — the caster) or 'ally'
 * (Bardic Inspiration — a chosen creature, sent as the socket payload's targetId).
 */
export interface AbilityDef {
  key: string;
  label: string;
  class: string;
  actionCost: ActionResource;
  /** Key into RESOURCE_DEFS (character.ts) — this ability's limited-use pool, always spent from the caster regardless of `target`. */
  resourceKey: string;
  target: "self" | "ally";
  onUse: EffectSpec[];
  /** Self-buff hooks this activation registers (Rage's resistance + melee damage bonus) — reuses registerSpellHooks, the exact path a self-buff spell (Mage Armor, Divine Favor) already goes through. */
  hooks?: HookSpec[];
  /** Present only for a "pick a name from this list" ability (Tinker's Magic) — the socket payload's chosenItem must be one of these; the server grants it as an inventory item instead of running onUse/hooks. */
  itemChoices?: string[];
  /** Present only for a "spend any amount up to what's left" ability (Lay on Hands) — the socket payload's chosenAmount is clamped to the pool and healed directly, bypassing onUse's dice-scaling path entirely. */
  amountChoice?: true;
}

/** Populated per-feature as each is wired up (see build audit) — empty is a valid, fully-functional state. */
export const ABILITY_DEFS: Record<string, AbilityDef> = {
  // 2024 PHB Fighter: Bonus Action, regain 1d10 + Fighter level HP. See RESOURCE_DEFS.secondWind
  // (character.ts) for the uses-per-rest pool.
  secondWind: {
    key: "secondWind",
    label: "Second Wind",
    class: "Fighter",
    actionCost: "bonusAction",
    resourceKey: "secondWind",
    target: "self",
    onUse: [{ type: "heal", scaling: { mode: "cantrip", base: "1d10", tiers: [] } }],
  },
  // 2024 PHB Barbarian: Bonus Action, resistance to B/P/S + a flat melee damage bonus (+2 at
  // 1-8, +3 at 9-15, +4 at 16-20 — the "0dN+flat" base/tiers below is the existing flat-value
  // dice idiom, same one Armor of Agathys' fixed temp HP already uses).
  // ponytail: RAW Rage ends early (no attack/damage-taken for a full turn, or donning Heavy
  // armor) and requires re-toggling each combat — 'endOfCombat' duration just keeps it on for
  // the rest of the fight once activated, and OnHitBonusDamageHook doesn't gate melee-only the
  // same way Sneak Attack's pilot doesn't (see passiveClassHooks.ts). Upgrade both together if
  // early-end tracking or attack-type gating ever get built.
  rage: {
    key: "rage",
    label: "Rage",
    class: "Barbarian",
    actionCost: "bonusAction",
    resourceKey: "rage",
    target: "self",
    onUse: [],
    hooks: [
      { type: "damageResistance", duration: { until: "endOfCombat" }, resistanceMode: "resistance", damageType: "Bludgeoning" },
      { type: "damageResistance", duration: { until: "endOfCombat" }, resistanceMode: "resistance", damageType: "Piercing" },
      { type: "damageResistance", duration: { until: "endOfCombat" }, resistanceMode: "resistance", damageType: "Slashing" },
      {
        type: "onHitBonusDamage",
        duration: { until: "endOfCombat" },
        scaling: { mode: "cantrip", base: "0d4+2", tiers: [{ atLevel: 9, value: "0d4+3" }, { atLevel: 16, value: "0d4+4" }] },
      },
    ],
  },
  // 2024 PHB Sorcerer: Bonus Action, 1 minute (~10 rounds) of +1 spell save DC and Advantage on
  // spell attack rolls. selfSpellAttacksOnly keeps the Advantage grant off weapon attacks — see
  // registerSpellHooks' grantAdvantage case and the 'grantAdvantageSelfSpellOnly' kind.
  innateSorcery: {
    key: "innateSorcery",
    label: "Innate Sorcery",
    class: "Sorcerer",
    actionCost: "bonusAction",
    resourceKey: "innateSorcery",
    target: "self",
    onUse: [],
    hooks: [
      { type: "dcModifier", duration: { until: "rounds", rounds: 10 }, value: 1 },
      { type: "grantAdvantage", duration: { until: "rounds", rounds: 10 }, self: true, selfSpellAttacksOnly: true },
    ],
  },
  // 2024 PHB Bard: Bonus Action, grants an ally a d6 usable on their next failed d20 Test within
  // the hour (consumeOnUse — spent the instant sumAndConsumeRollMods sums it into a roll).
  bardicInspiration: {
    key: "bardicInspiration",
    label: "Bardic Inspiration",
    class: "Bard",
    actionCost: "bonusAction",
    resourceKey: "bardicInspiration",
    target: "ally",
    onUse: [],
    hooks: [
      { type: "rollModifier", duration: { until: "gameTime", gameSecs: 3600 }, dieSize: 6, sign: 1, consumeOnUse: true },
    ],
  },
  // 2024 PHB Artificer: Magic action (modeled as the 'action' cost), create one mundane item
  // from the list within 5ft, gone at your next Long Rest. ponytail: simplified — the item lands
  // straight in inventory rather than tracking world position + Long-Rest expiry, and none of
  // these get a mechanical effect (Caltrops don't hazard, Rope doesn't climb); upgrade if a
  // player actually wants Tinker's Magic to do more than furnish flavor gear.
  tinkersMagic: {
    key: "tinkersMagic",
    label: "Tinker's Magic",
    class: "Artificer",
    actionCost: "action",
    resourceKey: "tinkersMagic",
    target: "self",
    onUse: [],
    itemChoices: [
      "Ball Bearings", "Basket", "Bedroll", "Bell", "Blanket", "Block and Tackle", "Bottle, Glass",
      "Bucket", "Caltrops", "Candle", "Crowbar", "Flask", "Grappling Hook", "Hunting Trap", "Jug",
      "Lamp", "Manacles", "Net", "Oil", "Paper", "Parchment", "Pole", "Pouch", "Rope", "Sack",
      "Shovel", "Spikes, Iron", "String", "Tinderbox", "Torch", "Vial",
    ],
  },
  // 2024 PHB Paladin: Bonus Action, touch a creature and spend any amount of the Lay on Hands
  // pool (RESOURCE_DEFS.layOnHands) to heal it — see AbilityDef.amountChoice. 'ally' target
  // reuses the same self-or-other-party-member picker Bardic Inspiration uses (clicking your own
  // token is a valid "ally" pick there already).
  layOnHands: {
    key: "layOnHands",
    label: "Lay on Hands",
    class: "Paladin",
    actionCost: "bonusAction",
    resourceKey: "layOnHands",
    target: "ally",
    onUse: [],
    amountChoice: true,
  },
};
