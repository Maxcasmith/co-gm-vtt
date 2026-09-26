import { useState } from "react";
import { createPortal } from "react-dom";
import type { Character, StoredFamiliar } from "shared";
import { PACT_FAMILIAR_FORMS } from "shared";
import { Button } from "../components/Button/Button.tsx";
import { dispatch } from "../events.ts";

/**
 * Find Familiar's pre-cast modal: re-summon (or delete) a stored familiar, or describe a new one. Pact of the
 * Chain adds its special forms ('' = the default Familiar). The server saves the pick to
 * Character.familiars on summon, so it shows up in the stored list next time.
 */
export function FindFamiliarModal({ character, onSummon, onClose }: {
  character: Character;
  onSummon: (familiar: StoredFamiliar) => void;
  onClose: () => void;
}) {
  const stored = character.familiars ?? [];
  const forms = character.invocations?.includes("Pact of the Chain") ? ["", ...Object.keys(PACT_FAMILIAR_FORMS)] : undefined;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [form, setForm] = useState("");

  function loadStored(storedName: string) {
    const f = stored.find((s) => s.name === storedName);
    if (!f) return;
    setName(f.name);
    setDescription(f.description);
    setForm(f.form ?? "");
  }

  function summon() {
    if (!name.trim()) return;
    onSummon({ name: name.trim(), description: description.trim(), ...(forms && form ? { form } : {}) });
  }

  return createPortal(
    <div className="modal-overlay modal-overlay--above-sheet" onClick={onClose}>
      <dialog className="modal campaign-modal" open onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Find Familiar</h2>
        </div>
        <div className="modal-form">
          <span className="modal-label">Stored familiars</span>
          {stored.length > 0 ? (
            <ul className="familiar-list">
              {stored.map((f) => (
                <li key={f.name} className={`familiar-row${f.name === name.trim() ? " familiar-row--active" : ""}`}>
                  <Button variant="ghost" className="familiar-row-pick" onClick={() => loadStored(f.name)}>
                    {f.name}
                    {f.form && <span className="spells-tag">{f.form}</span>}
                  </Button>
                  <Button
                    variant="ghost"
                    className="familiar-row-delete"
                    title={`Delete ${f.name}`}
                    onClick={() => {
                      if (!window.confirm(`Delete "${f.name}" from your stored familiars? This cannot be undone.`)) return;
                      dispatch("vtt:familiar:delete", { characterId: character.id, name: f.name });
                    }}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="spells-empty">No stored familiars yet — summon one below and it's saved here.</p>
          )}
          {forms && (
            <div className="sheet-spell-damage-types">
              {forms.map((f) => (
                <Button
                  key={f || "default"}
                  variant="ghost"
                  className={`sheet-damage-type-btn${form === f ? " sheet-damage-type-btn--active" : ""}`}
                  onClick={() => setForm(f)}
                >
                  {f || "Familiar"}
                </Button>
              ))}
            </div>
          )}
          <label className="modal-label">
            Name
            <input className="modal-input" type="text" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <label className="modal-label">
            Description
            <textarea
              className="modal-textarea"
              rows={4}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. A soot-black cat with one white ear, smells faintly of brimstone."
            />
          </label>
        </div>
        <div className="modal-actions">
          <Button variant="outline" color="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!name.trim()} onClick={summon}>Summon</Button>
        </div>
      </dialog>
    </div>,
    document.body,
  );
}
