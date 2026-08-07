import { useEffect, useMemo, useState } from "react";
import type { Character, Spell } from "shared";
import { isWeapon, actionCostFromCastingTime, parseRangeFeet } from "shared";
import { dispatch } from "../events.ts";
import { API, ActionCostDot } from "./helpers.tsx";

const LEVEL_HEADINGS: Record<number, string> = {
  0: "Cantrips",
  1: "First Level",
  2: "Second Level",
  3: "Third Level",
  4: "Fourth Level",
  5: "Fifth Level",
  6: "Sixth Level",
  7: "Seventh Level",
  8: "Eighth Level",
  9: "Ninth Level",
};

export function SpellsTab({
  character,
  combatActive,
  isMyTurn,
  actionAvailable,
  bonusActionAvailable,
  reactionAvailable,
  maxSpellSlots1,
  currentSpellSlots1,
}: {
  character: Character;
  combatActive: boolean;
  isMyTurn: boolean;
  actionAvailable: boolean;
  bonusActionAvailable: boolean;
  reactionAvailable: boolean;
  maxSpellSlots1: number;
  currentSpellSlots1: number;
}) {
  const learnedNames = character.spells ?? [];
  const [spells, setSpells] = useState<Spell[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Spell | null>(null);

  const resourceAvailable: Record<
    "action" | "bonusAction" | "reaction",
    boolean
  > = {
    action: actionAvailable,
    bonusAction: bonusActionAvailable,
    reaction: reactionAvailable,
  };

  const mainHandItem = character.inventory?.find(
    (i) => i.id === character.equipment?.mainHand,
  );
  const mainHandWeapon =
    mainHandItem && isWeapon(mainHandItem) ? mainHandItem : undefined;

  // One-shot self-buffs that only matter on the weapon hit they're cast for (Divine Smite, ...) —
  // bundle cast + attack into one interaction rather than a separate "next hit" queue. Duration
  // buffs like Divine Favor/Zephyr Strike stay on the old immediate-self-cast path below.
  function isBundledSmite(spell: Spell): boolean {
    return (
      spell.combat?.resolution === "none" &&
      !spell.combat?.save &&
      parseRangeFeet(spell.range) === 0 &&
      spell.duration === "Instantaneous" &&
      !!spell.combat?.onHit?.some((e) => e.type === "damage")
    );
  }

  // Redirecting an already-sustained spell (Hunter's Mark, Witch Bolt) is free — no slot spent —
  // so the empty-slots gate must not block it.
  function isFreeRecast(spell: Spell): boolean {
    return character.conditions?.some(
      (c) => c.name === "Concentrating" && c.concentration?.spellName === spell.name,
    ) ?? false;
  }

  // Only level-1 slots are tracked today, so a leveled spell is castable only while that
  // pool has slots left — no higher tier exists yet to upcast into when it's empty.
  function noSlotFor(spell: Spell): boolean {
    return spell.level >= 1 && currentSpellSlots1 <= 0 && !isFreeRecast(spell);
  }

  function handleCast(spell: Spell) {
    const cost = actionCostFromCastingTime(spell.castingTime);
    if (!combatActive || !isMyTurn || !cost || !resourceAvailable[cost] || noSlotFor(spell)) return;

    if (isBundledSmite(spell)) {
      if (!mainHandWeapon || !actionAvailable) return;
      dispatch("vtt:sheet:closed", {});
      dispatch("vtt:targeting:start", {
        kind: "weapon",
        weapon: mainHandWeapon,
        actionType: "action",
        bonusSpell: spell,
      });
      return;
    }

    dispatch("vtt:sheet:closed", {});

    // Self-range, no area (pure buff/utility) — nothing to place, just resolve immediately.
    if (parseRangeFeet(spell.range) === 0 && !spell.combat?.area) {
      dispatch("vtt:combat:spell:cast", {
        casterName: character.name,
        casterId: character.id,
        spell,
        slotLevel: spell.level,
        targetIds: [character.id],
      });
      return;
    }
    dispatch("vtt:targeting:start", {
      kind: "spell",
      spell,
      casterId: character.id,
      actionType: cost,
    });
  }

  useEffect(() => {
    if (!learnedNames.length) return;
    fetch(`${API}/api/spells?class=${encodeURIComponent(character.class)}`)
      .then((r) => r.json())
      .then((all: Spell[]) =>
        setSpells(all.filter((s) => learnedNames.includes(s.name))),
      )
      .catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.class, learnedNames.join(",")]);

  const filtered = useMemo(() => {
    if (!search.trim()) return spells;
    const q = search.toLowerCase();
    return spells.filter((s) => s.name.toLowerCase().includes(q));
  }, [spells, search]);

  const byLevel = useMemo(() => {
    const map = new Map<number, Spell[]>();
    for (const s of filtered) {
      const bucket = map.get(s.level) ?? [];
      bucket.push(s);
      map.set(s.level, bucket);
    }
    return map;
  }, [filtered]);

  return (
    <>
      <input
        className="sheet-spells-search"
        placeholder="Search spells…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {selected && (
        <div className="sheet-spell-detail">
          <div className="sheet-spell-detail-header">
            <div>
              <span className="sheet-spell-detail-name">{selected.name}</span>
              <span className="sheet-spell-detail-sub">
                {selected.levelLabel} · {selected.school}
                {selected.isRitual ? " · Ritual" : ""}
              </span>
            </div>
            <button
              className="sheet-spell-detail-close"
              onClick={() => setSelected(null)}
            >
              ×
            </button>
          </div>
          <dl className="sheet-spell-detail-stats">
            <dt>Casting Time</dt>
            <dd>{selected.castingTime}</dd>
            <dt>Range</dt>
            <dd>{selected.range}</dd>
            <dt>Components</dt>
            <dd>{selected.components}</dd>
            <dt>Duration</dt>
            <dd>{selected.duration}</dd>
          </dl>
          <p className="sheet-spell-detail-text">{selected.text}</p>
          {selected.atHigherLevels && (
            <p className="sheet-spell-detail-higher">
              <em>At Higher Levels.</em> {selected.atHigherLevels}
            </p>
          )}
          {(() => {
            const cost = actionCostFromCastingTime(selected.castingTime);
            const disabled =
              !combatActive || !isMyTurn || !cost || !resourceAvailable[cost] ||
              noSlotFor(selected) ||
              (isBundledSmite(selected) && (!mainHandWeapon || !actionAvailable));
            return (
              <button
                className={`sheet-spell-cast-btn${disabled ? " sheet-spell-cast-btn--disabled" : ""}`}
                disabled={disabled}
                onClick={() => handleCast(selected)}
              >
                {isBundledSmite(selected) ? (
                  <>
                    <ActionCostDot cost="action" />
                    <ActionCostDot cost="bonusAction" />
                  </>
                ) : (
                  <ActionCostDot cost={cost} />
                )}
                Cast
              </button>
            );
          })()}
        </div>
      )}

      {byLevel.size === 0 && (
        <div className="sheet-empty">
          <p className="sheet-empty-title">No results</p>
          <p className="sheet-empty-hint">No spells match "{search}"</p>
        </div>
      )}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => {
        const group = byLevel.get(level);
        if (!group?.length) return null;
        return (
          <div key={level} className="sheet-inv-section">
            <p className="sheet-inv-section-title">
              {LEVEL_HEADINGS[level]}
              {level === 1 && maxSpellSlots1 > 0 && (
                <span className="sheet-spell-slots">
                  {Array.from({ length: maxSpellSlots1 }, (_, i) => (
                    <span
                      key={i}
                      className={`sheet-spell-slot${i < currentSpellSlots1 ? " sheet-spell-slot--filled" : ""}`}
                    />
                  ))}
                </span>
              )}
            </p>
            <div className="sheet-inventory">
              {group.map((spell) => (
                <div
                  key={spell.name}
                  className={`sheet-inv-card sheet-inv-card--spell${selected?.name === spell.name ? " sheet-inv-card--spell-active" : ""}`}
                  onClick={() =>
                    setSelected((s) => (s?.name === spell.name ? null : spell))
                  }
                >
                  <div className="sheet-inv-card-header">
                    <span className="sheet-inv-name">{spell.name}</span>
                    <div className="sheet-inv-card-header-right">
                      <ActionCostDot
                        cost={actionCostFromCastingTime(spell.castingTime)}
                      />
                      {spell.isRitual && (
                        <span className="sheet-spell-ritual">R</span>
                      )}
                    </div>
                  </div>
                  <p className="sheet-inv-desc">
                    {spell.school} · {spell.castingTime}
                  </p>
                  <p className="sheet-inv-desc">
                    {spell.range} · {spell.duration}
                  </p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
