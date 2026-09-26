import { useState } from "react";
import { createPortal } from "react-dom";
import type { Character } from "shared";
import { isWeapon, unarmedStrikeFor, PACT_WEAPON_CHOICES, PACT_WEAPON_DAMAGE_TYPES } from "shared";
import { Button } from "../components/Button/Button.tsx";
import TileGrid from "../character-creation/TileGrid.tsx";
import { dispatch } from "../events.ts";

// Warlock pact actions shared by the combat dock and the character sheet's Features tab.

/**
 * Pact of the Chain: forgo your attack so your familiar attacks with its Reaction. The weapon is
 * only a stand-in for the 100 ft telepathic-bond range ring; the server finds the familiar and
 * checks it's within 5 ft of the clicked enemy (combat:familiar:attack).
 */
export function startFamiliarAttack(character: Character) {
  dispatch("vtt:sheet:closed", {});
  dispatch("vtt:targeting:start", {
    kind: "weapon",
    weapon: { ...unarmedStrikeFor(character), id: "familiar-attack", name: "Familiar Attack", range: 100 },
    actionType: "action",
    viaFamiliar: true,
  });
}

/** Pact of the Blade: conjure a catalog melee weapon, or bond a carried magic one (attack bonus), with an optional damage swap. */
export function PactWeaponModal({ character, onClose }: { character: Character; onClose: () => void }) {
  // '' = the weapon's own damage type.
  const [damageType, setDamageType] = useState("");
  const choices = [
    ...PACT_WEAPON_CHOICES.map((w) => ({ id: `conjure:${w.id}`, name: w.name })),
    ...(character.inventory ?? []).filter((i) => isWeapon(i) && i.range <= 10 && (i.attackBonus ?? 0) > 0)
      .map((i) => ({ id: `bond:${i.id}`, name: i.name, meta: <span className="spells-tag">Bond</span> })),
  ];

  function pick(id: string) {
    onClose();
    const [kind, ref] = id.split(":") as [string, string];
    dispatch("vtt:combat:pact:bond", {
      characterId: character.id,
      ...(kind === "bond" ? { itemId: ref } : { weaponId: ref }),
      ...(damageType ? { damageType } : {}),
    });
  }

  return createPortal(
    <div className="modal-overlay modal-overlay--above-sheet" onClick={onClose}>
      <dialog className="modal campaign-modal" open onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Pact Weapon</h2>
        </div>
        <div className="modal-form">
          <div className="sheet-spell-damage-types">
            {["", ...PACT_WEAPON_DAMAGE_TYPES].map((type) => (
              <Button
                key={type || "normal"}
                variant="ghost"
                className={`sheet-damage-type-btn${type ? ` sheet-damage-type-btn--${type}` : ""}${damageType === type ? " sheet-damage-type-btn--active" : ""}`}
                onClick={() => setDamageType(type)}
              >
                {type ? type.charAt(0).toUpperCase() + type.slice(1) : "Normal damage"}
              </Button>
            ))}
          </div>
          <TileGrid items={choices} selectedId="" onSelect={pick} />
        </div>
        <div className="modal-actions">
          <Button variant="outline" color="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </dialog>
    </div>,
    document.body,
  );
}
