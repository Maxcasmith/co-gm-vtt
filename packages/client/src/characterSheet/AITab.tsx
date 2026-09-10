import { useEffect, useState } from "react";
import type { ActionResource, Character, Directive, DirectiveKind, Group, Manoeuvre, Spell, TacticCondition, TargetRef, TargetStrategy } from "shared";
import { CONDITIONS, actionCostFromCastingTime, isConsumable } from "shared";
import { Button } from "../components/Button/Button.tsx";
import { dispatch } from "../events.ts";
import { API } from "./helpers.tsx";

const TARGET_LABELS: Record<TargetStrategy, string> = {
  self: "Self",
  closestEnemy: "Closest enemy",
  lowestHpEnemy: "Enemy with lowest health",
  highestHpEnemy: "Enemy with highest health",
  closestAlly: "Closest ally",
  lowestHpAlly: "Ally with lowest health",
  highestHpAlly: "Ally with highest health",
  allyWithStatus: "Ally with status infliction",
};
const STATUS_FILTER_OPTIONS: readonly ("any" | (typeof CONDITIONS)[number])[] = ["any", ...CONDITIONS];
// Same pattern InventoryTab.tsx's Consumables section uses — kept in sync manually, see AITab's `items` build note.
const CONSUMABLE_NAMES = /potion|scroll|ration|herb|tincture|elixir|berry/i;

function defaultTargetRef(strategy: TargetStrategy): TargetRef {
  return strategy === "allyWithStatus" ? { strategy, statusFilter: "any" } : { strategy };
}
function targetRefLabel(ref: TargetRef): string {
  return ref.strategy === "allyWithStatus" && ref.statusFilter && ref.statusFilter !== "any"
    ? `${TARGET_LABELS[ref.strategy]} (${ref.statusFilter})`
    : TARGET_LABELS[ref.strategy];
}
/** Legacy manoeuvres saved `defaultTarget`/a "target" directive's target as a bare TargetStrategy string, before TargetRef existed — not real player data, normalized rather than dropped. */
function normalizeTargetRef(value: unknown): TargetRef {
  return value && typeof value === "object" ? (value as TargetRef) : defaultTargetRef("closestEnemy");
}

function newDirective(): Directive {
  return { id: crypto.randomUUID(), type: "directive", kind: "attackWithWeapon" };
}
function newGroup(): Group {
  return { id: crypto.randomUUID(), type: "group", condition: { kind: "always" }, children: [] };
}
function newManoeuvre(): Manoeuvre {
  return { id: crypto.randomUUID(), name: "New manoeuvre", defaultTarget: defaultTargetRef("closestEnemy"), root: newGroup() };
}

// ── Tree helpers — every one recurses to find `id` wherever it actually lives, so callers never need to track parent ids. ──

function updateGroupNode(group: Group, id: string, patch: Partial<Group>): Group {
  if (group.id === id) return { ...group, ...patch };
  return { ...group, children: group.children.map(c => (c.type === "group" ? updateGroupNode(c, id, patch) : c)) };
}
function updateDirectiveNode(group: Group, id: string, patch: Partial<Directive>): Group {
  return {
    ...group,
    children: group.children.map(c =>
      c.type === "directive" ? (c.id === id ? { ...c, ...patch } : c) : updateDirectiveNode(c, id, patch)),
  };
}
function addChildNode(group: Group, parentId: string, child: Group | Directive): Group {
  if (group.id === parentId) return { ...group, children: [...group.children, child] };
  return { ...group, children: group.children.map(c => (c.type === "group" ? addChildNode(c, parentId, child) : c)) };
}
function removeChildNode(group: Group, id: string): Group {
  return {
    ...group,
    children: group.children.filter(c => c.id !== id).map(c => (c.type === "group" ? removeChildNode(c, id) : c)),
  };
}
function moveChildNode(group: Group, id: string, dir: -1 | 1): Group {
  const i = group.children.findIndex(c => c.id === id);
  if (i >= 0) {
    const j = i + dir;
    if (j < 0 || j >= group.children.length) return group;
    const next = [...group.children];
    [next[i], next[j]] = [next[j]!, next[i]!];
    return { ...group, children: next };
  }
  return { ...group, children: group.children.map(c => (c.type === "group" ? moveChildNode(c, id, dir) : c)) };
}

type Resource = "movement" | ActionResource;

/** Same classification executionLoop.ts uses server-side (a spell's/item's real action/bonus-action/reaction cost, not a blanket guess) — `spellCosts`/`itemCosts` are looked up once, see AITab's fetch effect and `items`. A "target" directive isn't itself an action, so it's never classified — see hasConflict, which skips it entirely. */
function directiveResource(d: Directive, spellCosts: Record<string, ActionResource>, itemCosts: Record<string, ActionResource>): Resource {
  if (d.kind === "move") return "movement";
  if (d.kind === "attackWithWeapon" || d.kind === "dash" || d.kind === "disengage" || d.kind === "dodge") return "action";
  if (d.kind === "useConsumable") return itemCosts[d.itemId ?? ""] ?? "action";
  return spellCosts[d.spellName ?? ""] ?? "action";
}
function hasConflict(group: Group, spellCosts: Record<string, ActionResource>, itemCosts: Record<string, ActionResource>): boolean {
  const counts: Partial<Record<Resource, number>> = {};
  for (const c of group.children) {
    if (c.type === "directive" && c.kind !== "target") {
      const r = directiveResource(c, spellCosts, itemCosts);
      counts[r] = (counts[r] ?? 0) + 1;
    }
  }
  if (Object.values(counts).some(n => (n ?? 0) >= 2)) return true;
  return group.children.some(c => c.type === "group" && hasConflict(c, spellCosts, itemCosts));
}

interface TreeCallbacks {
  updateGroup: (id: string, patch: Partial<Group>) => void;
  updateDirective: (id: string, patch: Partial<Directive>) => void;
  addGroup: (parentId: string) => void;
  addDirective: (parentId: string) => void;
  remove: (id: string) => void;
  move: (id: string, dir: -1 | 1) => void;
}

export function AITab({ character }: { character: Character }) {
  const [aiControlled, setAiControlled] = useState(character.aiControlled ?? false);
  // Drops any pre-tree manoeuvre saved before `root` existed — stale shape, not real player data.
  // `defaultTarget` is newer still and additive, so it's defaulted rather than treated as another reason to drop.
  const [tactics, setTactics] = useState<Manoeuvre[]>(
    (character.tactics ?? [])
      .filter(m => m.root?.type === "group")
      .map(m => ({ ...m, defaultTarget: normalizeTargetRef(m.defaultTarget) })),
  );
  const knownSpells = character.spells ?? [];
  // Same fallback InventoryTab's own Consumables section uses — some persisted items are missing
  // the "consumable" type discriminant entirely (e.g. a stored Potion of Healing with type: null),
  // so name-matching catches what isConsumable's structural check alone would miss.
  const items = (character.inventory ?? []).filter(i => isConsumable(i) || CONSUMABLE_NAMES.test(i.name));
  // Real action/bonus-action cost per consumable, straight off the item where it's actually typed as one — falls back to "action" for the name-matched-only stragglers above, which have no actionCost field at all.
  const itemCosts: Record<string, ActionResource> = Object.fromEntries(items.map(i => [i.id, isConsumable(i) ? i.actionCost : "action"]));

  // Real action/bonus-action/reaction cost per known spell, for the conflict check below — same
  // classification resolvePlayerSpellAttack uses server-side. Unresolved (still loading, or a
  // feat-granted spell from a class not covered by this fetch) falls back to "action" — see
  // directiveResource.
  const [spellCosts, setSpellCosts] = useState<Record<string, ActionResource>>({});
  useEffect(() => {
    if (!knownSpells.length) return;
    fetch(`${API}/api/spells?class=${encodeURIComponent(character.class)}`)
      .then(r => r.json())
      .then((all: Spell[]) => {
        const costs: Record<string, ActionResource> = {};
        for (const s of all) {
          if (!knownSpells.includes(s.name)) continue;
          costs[s.name] = s.combat?.actionCostOverride ?? actionCostFromCastingTime(s.castingTime) ?? "action";
        }
        setSpellCosts(costs);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.class, knownSpells.join(",")]);

  function persist(nextTactics: Manoeuvre[], nextAiControlled: boolean) {
    setTactics(nextTactics);
    setAiControlled(nextAiControlled);
    dispatch("vtt:tactics:update", {
      characterId: character.id, tactics: nextTactics, aiControlled: nextAiControlled,
    });
  }

  function updateManoeuvre(id: string, patch: Partial<Manoeuvre>) {
    persist(tactics.map(m => (m.id === id ? { ...m, ...patch } : m)), aiControlled);
  }

  return (
    <div className="sheet-feature-group">
      <label className="sheet-tactic-toggle-row">
        <span className="sheet-toggle-switch">
          <input
            type="checkbox"
            checked={aiControlled}
            onChange={e => persist(tactics, e.target.checked)}
          />
          <span className="sheet-toggle-switch-track" />
        </span>
        <span>Let AI control this character while I'm offline</span>
      </label>

      {tactics.length === 0 ? (
        <div className="sheet-empty">
          <p className="sheet-empty-title">No manoeuvres yet</p>
          <p className="sheet-empty-hint">Add one below — every eligible directive competes each decision point, best one wins.</p>
        </div>
      ) : (
        <div className="sheet-tactic-list">
          {tactics.map(m => (
            <ManoeuvreCard
              key={m.id}
              manoeuvre={m}
              knownSpells={knownSpells}
              spellCosts={spellCosts}
              items={items}
              itemCosts={itemCosts}
              onChange={patch => updateManoeuvre(m.id, patch)}
              onRemove={() => persist(tactics.filter(t => t.id !== m.id), aiControlled)}
            />
          ))}
        </div>
      )}

      <Button
        variant="ghost"
        className="sheet-tactic-add-btn"
        onClick={() => persist([...tactics, newManoeuvre()], aiControlled)}
      >
        + Add manoeuvre
      </Button>
    </div>
  );
}

function ManoeuvreCard({
  manoeuvre, knownSpells, spellCosts, items, itemCosts, onChange, onRemove,
}: {
  manoeuvre: Manoeuvre;
  knownSpells: string[];
  spellCosts: Record<string, ActionResource>;
  items: { id: string; name: string }[];
  itemCosts: Record<string, ActionResource>;
  onChange: (patch: Partial<Manoeuvre>) => void;
  onRemove: () => void;
}) {
  const cb: TreeCallbacks = {
    updateGroup: (id, patch) => onChange({ root: updateGroupNode(manoeuvre.root, id, patch) }),
    updateDirective: (id, patch) => onChange({ root: updateDirectiveNode(manoeuvre.root, id, patch) }),
    addGroup: parentId => onChange({ root: addChildNode(manoeuvre.root, parentId, newGroup()) }),
    addDirective: parentId => onChange({ root: addChildNode(manoeuvre.root, parentId, newDirective()) }),
    remove: id => onChange({ root: removeChildNode(manoeuvre.root, id) }),
    move: (id, dir) => onChange({ root: moveChildNode(manoeuvre.root, id, dir) }),
  };
  const conflicted = hasConflict(manoeuvre.root, spellCosts, itemCosts);

  return (
    <div className={`sheet-manoeuvre-card${conflicted ? " sheet-manoeuvre-card--conflict" : ""}`}>
      <div className="sheet-manoeuvre-header">
        <input
          className="sheet-manoeuvre-name"
          value={manoeuvre.name}
          onChange={e => onChange({ name: e.target.value })}
        />
        <Button variant="ghost" onClick={onRemove}>✕</Button>
      </div>

      <div className="sheet-tactic-row sheet-tactic-row--fixed">
        <div className="sheet-tactic-editor">
          <span className="sheet-group-logic-label">Target</span>
          <TargetRefEditor
            targetRef={manoeuvre.defaultTarget}
            onChange={ref => onChange({ defaultTarget: ref })}
          />
        </div>
      </div>

      <GroupBlock
        group={manoeuvre.root} isRoot isFirst canMoveUp={false} canMoveDown={false}
        knownSpells={knownSpells} items={items} inheritedTargetRef={undefined} cb={cb}
      />

      {conflicted && (
        <p className="sheet-manoeuvre-warning">
          This manoeuvre asks for more than one action, bonus action, or movement at the same time — only one can actually happen.
        </p>
      )}
    </div>
  );
}

function GroupBlock({
  group, isRoot, isFirst, canMoveUp, canMoveDown, knownSpells, items, inheritedTargetRef, cb,
}: {
  group: Group;
  isRoot: boolean;
  isFirst: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  knownSpells: string[];
  items: { id: string; name: string }[];
  /** Nearest "target" directive found so far, scanning backward through this group's own preceding siblings first, then its ancestors' — see DirectiveBlock's inferredTargetRef doc. */
  inheritedTargetRef: TargetRef | undefined;
  cb: TreeCallbacks;
}) {
  return (
    <div className="sheet-group-block">
      <div className="sheet-group-header">
        <span className="sheet-group-logic-label">{isFirst ? "When" : "Or When"}</span>
        <Button
          variant="ghost"
          className={`sheet-group-not-btn${group.negate ? " sheet-group-not-btn--active" : ""}`}
          onClick={() => cb.updateGroup(group.id, { negate: !group.negate })}
          title="Invert this condition"
        >
          Not
        </Button>
        <ConditionEditor condition={group.condition} onChange={c => cb.updateGroup(group.id, { condition: c })} />
        {!isRoot && (
          <div className="sheet-tactic-controls">
            <Button variant="ghost" onClick={() => cb.move(group.id, -1)} disabled={!canMoveUp}>↑</Button>
            <Button variant="ghost" onClick={() => cb.move(group.id, 1)} disabled={!canMoveDown}>↓</Button>
            <Button variant="ghost" onClick={() => cb.remove(group.id)}>✕</Button>
          </div>
        )}
      </div>

      <div className="sheet-group-children">
        {(() => {
          // Left-to-right fold, mirroring the server's walkGroup: a "target" directive updates
          // the running nearest-target for everything after it in this same list, and that value
          // is what nested groups inherit as their own starting point — see inheritedTargetRef.
          let nearestTargetRef = inheritedTargetRef;
          return group.children.map((child, i) => {
            if (child.type === "group") {
              return (
                <GroupBlock
                  key={child.id} group={child} isRoot={false} isFirst={i === 0}
                  canMoveUp={i > 0} canMoveDown={i < group.children.length - 1}
                  knownSpells={knownSpells} items={items} inheritedTargetRef={nearestTargetRef} cb={cb}
                />
              );
            }
            if (child.kind === "target") nearestTargetRef = child.target;
            return (
              <DirectiveBlock
                key={child.id} directive={child} knownSpells={knownSpells} items={items} inferredTargetRef={nearestTargetRef}
                canMoveUp={i > 0} canMoveDown={i < group.children.length - 1} cb={cb}
              />
            );
          });
        })()}
      </div>

      <div className="sheet-group-add-buttons">
        <Button variant="ghost" onClick={() => cb.addGroup(group.id)}>+ Add Group</Button>
        <Button variant="ghost" onClick={() => cb.addDirective(group.id)}>+ Add Directive</Button>
      </div>
    </div>
  );
}

function DirectiveBlock({
  directive, knownSpells, items, inferredTargetRef, canMoveUp, canMoveDown, cb,
}: {
  directive: Directive;
  knownSpells: string[];
  items: { id: string; name: string }[];
  /** Nearest "target" directive in scope — this group's own preceding siblings first, then each ancestor group's preceding siblings in turn. Only "move" reads it; undefined means nothing upstream, so it falls back to the manoeuvre's fixed Target. */
  inferredTargetRef: TargetRef | undefined;
  canMoveUp: boolean;
  canMoveDown: boolean;
  cb: TreeCallbacks;
}) {
  return (
    <div className="sheet-tactic-row">
      <div className="sheet-tactic-editor">
        <select
          value={directive.kind}
          onChange={e => {
            const kind = e.target.value as DirectiveKind;
            cb.updateDirective(directive.id, {
              kind,
              spellName: kind === "castSpell" ? (knownSpells[0] ?? "") : undefined,
              target: kind === "target" ? defaultTargetRef("closestEnemy") : undefined,
              itemId: kind === "useConsumable" ? items[0]?.id : undefined,
            });
          }}
        >
          <option value="move">Move</option>
          <option value="attackWithWeapon">Attack with weapon</option>
          <option value="castSpell" disabled={knownSpells.length === 0}>Cast a spell</option>
          <option value="dash">Dash</option>
          <option value="disengage">Disengage</option>
          <option value="dodge">Dodge</option>
          <option value="useConsumable" disabled={items.length === 0}>Use consumable</option>
          <option value="target">Target</option>
        </select>

        {directive.kind === "castSpell" && (
          <select value={directive.spellName ?? ""} onChange={e => cb.updateDirective(directive.id, { spellName: e.target.value })}>
            {knownSpells.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}

        {directive.kind === "useConsumable" && (
          <select value={directive.itemId ?? ""} onChange={e => cb.updateDirective(directive.id, { itemId: e.target.value })}>
            {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        )}

        {directive.kind === "target" && (
          <TargetRefEditor
            targetRef={directive.target ?? defaultTargetRef("closestEnemy")}
            onChange={ref => cb.updateDirective(directive.id, { target: ref })}
          />
        )}

        {directive.kind === "move" && (
          <>
            <select
              value={directive.direction ?? "toward"}
              onChange={e => cb.updateDirective(directive.id, { direction: e.target.value as "toward" | "away" })}
            >
              <option value="toward">Towards</option>
              <option value="away">Away</option>
            </select>
            <span className="sheet-tactic-target-label">
              {inferredTargetRef ? targetRefLabel(inferredTargetRef) : "Manoeuvre's target"}
            </span>
          </>
        )}
      </div>
      <div className="sheet-tactic-controls">
        <Button variant="ghost" onClick={() => cb.move(directive.id, -1)} disabled={!canMoveUp}>↑</Button>
        <Button variant="ghost" onClick={() => cb.move(directive.id, 1)} disabled={!canMoveDown}>↓</Button>
        <Button variant="ghost" onClick={() => cb.remove(directive.id)}>✕</Button>
      </div>
    </div>
  );
}

function TargetRefEditor({ targetRef, onChange }: { targetRef: TargetRef; onChange: (ref: TargetRef) => void }) {
  return (
    <>
      <select
        value={targetRef.strategy}
        onChange={e => onChange(defaultTargetRef(e.target.value as TargetStrategy))}
      >
        {Object.entries(TARGET_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
      {targetRef.strategy === "allyWithStatus" && (
        <select
          value={targetRef.statusFilter ?? "any"}
          onChange={e => onChange({ ...targetRef, statusFilter: e.target.value as TargetRef["statusFilter"] })}
        >
          {STATUS_FILTER_OPTIONS.map(s => <option key={s} value={s}>{s === "any" ? "Any" : s}</option>)}
        </select>
      )}
    </>
  );
}

function ConditionEditor({ condition, onChange }: { condition: TacticCondition; onChange: (c: TacticCondition) => void }) {
  return (
    <div className="sheet-tactic-editor">
      <select
        value={condition.kind}
        onChange={e => {
          const nextKind = e.target.value as TacticCondition["kind"];
          onChange(
            nextKind === "hpBelowPct" ? { kind: "hpBelowPct", unit: "percent", amount: 50 } :
            nextKind === "statusPresent" ? { kind: "statusPresent", status: CONDITIONS[0] } :
            nextKind === "inRange" ? { kind: "inRange", ft: 30 } :
            nextKind === "lastActionMissed" ? { kind: "lastActionMissed" } :
            { kind: "always" },
          );
        }}
      >
        <option value="always">Always</option>
        <option value="hpBelowPct">HP below</option>
        <option value="statusPresent">Status present</option>
        <option value="inRange">In range</option>
        <option value="lastActionMissed">My last action missed</option>
      </select>

      {condition.kind === "hpBelowPct" && (
        <>
          <input
            type="number" min={0} max={condition.unit === "percent" ? 100 : undefined} value={condition.amount}
            onChange={e => onChange({ ...condition, amount: Number(e.target.value) })}
          />
          <select
            value={condition.unit}
            onChange={e => onChange({ ...condition, unit: e.target.value as "percent" | "hp" })}
          >
            <option value="percent">Percent</option>
            <option value="hp">Health Points</option>
          </select>
        </>
      )}

      {condition.kind === "statusPresent" && (
        <select value={condition.status} onChange={e => onChange({ ...condition, status: e.target.value as typeof condition.status })}>
          {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      )}

      {condition.kind === "inRange" && (
        <>
          <input
            type="number" min={5} step={5} value={condition.ft}
            onChange={e => onChange({ ...condition, ft: Number(e.target.value) })}
          />
          <span>ft</span>
        </>
      )}
    </div>
  );
}
