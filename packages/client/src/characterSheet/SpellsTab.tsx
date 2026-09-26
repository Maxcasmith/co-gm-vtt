import { useEffect, useMemo, useState } from "react";
import type { Character, Spell } from "shared";
import { FEAT_SPELL_GRANTS } from "shared";
import { Button } from "../components/Button/Button.tsx";
import { API, ActionCostDot } from "./helpers.tsx";
import { BACKGROUND_FEAT } from "../character-creation/srd.ts";
import { castBlocked, castSpell, defaultSpellChoices, isBundledSmite, spellActionCost } from "./spellCasting.ts";
import type { CastContext, SpellChoices } from "./spellCasting.ts";
import { SpellOptions } from "./SpellOptions.tsx";
import { FindFamiliarModal } from "./FindFamiliarModal.tsx";

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
  const [choices, setChoices] = useState<SpellChoices>({});
  const [customCommand, setCustomCommand] = useState("");
  // Find Familiar asks for a name/description (FindFamiliarModal) before it casts.
  const [familiarSpell, setFamiliarSpell] = useState<Spell | null>(null);

  // Magic Initiate can grant spells from a different class entirely. A character can have up to
  // two independent sources: their Background's fixed feat, and (Human only) their own
  // "Versatile" pick — same dual-source shape as character-creation/SpellsTab.tsx.
  const bgFeatName = BACKGROUND_FEAT[character.background];
  const featSourceNames = [...new Set([bgFeatName, character.species === 'Human' ? character.speciesOriginFeat : undefined])]
    .filter((name): name is string => !!name && name in FEAT_SPELL_GRANTS);
  const featSources = featSourceNames.map(name => ({ name, grant: FEAT_SPELL_GRANTS[name]! }));
  function featSpellSource(spell: Spell): string | undefined {
    return featSources.find(fs => spell.classes.includes(fs.grant.forClass) && !spell.classes.includes(character.class))?.name;
  }
  // Recorded at learn time going forward; older saves without spellSources fall back to the
  // structural heuristic (only correct when the feat's class differs from the character's own).
  function sourceOf(spell: Spell): string {
    return character.spellSources?.[spell.name] ?? featSpellSource(spell) ?? character.class;
  }

  const castCtx: CastContext = {
    character,
    combatActive,
    isMyTurn,
    resources: { action: actionAvailable, bonusAction: bonusActionAvailable, reaction: reactionAvailable },
    currentSpellSlots1,
  };

  function handleCast(spell: Spell) {
    if (spell.name === "Find Familiar") {
      setFamiliarSpell(spell);
      return;
    }
    castSpell(castCtx, spell, { ...choices, command: customCommand.trim() || choices.command });
  }

  useEffect(() => {
    setChoices(selected ? defaultSpellChoices(selected) : {});
    setCustomCommand("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.name]);

  useEffect(() => {
    if (!learnedNames.length) return;
    // Not class-filtered: feat and lineage spells (Tiefling's Thaumaturgy) can come from any class
    // list, and learnedNames is already the exact set to show.
    fetch(`${API}/api/spells`)
      .then((r) => r.json())
      .then((all: Spell[]) =>
        setSpells(all.filter((s) => learnedNames.includes(s.name))),
      )
      .catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learnedNames.join(",")]);

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

  function spellCard(spell: Spell) {
    const source = sourceOf(spell);
    return (
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
              cost={spellActionCost(spell)}
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
        {source && source !== character.class && (
          <p className="sheet-inv-desc sheet-spell-source">{source}</p>
        )}
      </div>
    );
  }

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
            <Button
              variant="ghost"
              className="sheet-spell-detail-close"
              onClick={() => setSelected(null)}
            >
              ×
            </Button>
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
          <SpellOptions
            spell={selected}
            choices={choices}
            customCommand={customCommand}
            onChange={setChoices}
            onCustomCommandChange={setCustomCommand}
          />
          {(() => {
            const cost = spellActionCost(selected);
            const disabled = castBlocked(castCtx, selected);
            return (
              <Button
                variant="ghost"
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
              </Button>
            );
          })()}
          {familiarSpell && (
            <FindFamiliarModal
              character={character}
              onClose={() => setFamiliarSpell(null)}
              onSummon={(familiar) => {
                setFamiliarSpell(null);
                castSpell(castCtx, familiarSpell, { familiar });
              }}
            />
          )}
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
            <div className="sheet-inventory">{group.map(spellCard)}</div>
          </div>
        );
      })}
    </>
  );
}
