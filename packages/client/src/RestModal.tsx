import { useEffect, useState } from 'react';
import type { Character } from 'shared';
import { on, dispatch } from './events.ts';
import type { RestResultPayload } from './events.ts';
import { HIT_DICE } from './character-creation/srd.ts';

const API = `http://${window.location.hostname}:3001`;

function modNum(score: number) { return Math.floor((score - 10) / 2); }

type RestType = 'short' | 'long';
type PartyMember = Omit<Character, 'password'>;

interface Props { character: Character }

export default function RestModal({ character }: Props) {
  const [open, setOpen]                 = useState(false);
  const [party, setParty]               = useState<PartyMember[]>([]);
  const [resting, setResting]           = useState(true);
  const [restType, setRestType]         = useState<RestType>('short');
  const [hitDiceSpent, setHitDiceSpent] = useState(0);
  const [brokenTokens, setBrokenTokens] = useState<Set<string>>(new Set());
  const [waiting, setWaiting]           = useState(false);
  const [allCommitted, setAllCommitted] = useState(false);
  const [result, setResult]             = useState<RestResultPayload | null>(null);

  useEffect(() => on('vtt:rest:open', () => { setOpen(true); setResult(null); setWaiting(false); setAllCommitted(false); }), []);

  useEffect(() => on('vtt:rest:result', data => {
    if (!data.resting) { setOpen(false); return; }
    setResult(data);
    setWaiting(false);
  }), []);

  useEffect(() => on('vtt:rest:progress', ({ allCommitted }) => setAllCommitted(allCommitted)), []);

  useEffect(() => {
    if (!open) return;
    setResting(true);
    setRestType('short');
    setHitDiceSpent(0);
    setResult(null);
    setWaiting(false);
    setAllCommitted(false);
    fetch(`${API}/api/campaigns/${character.campaignId}/party`)
      .then(r => r.json() as Promise<PartyMember[]>)
      .then(setParty)
      .catch(() => {});
  }, [open, character.campaignId]);

  function handleStart() {
    if (!resting) {
      dispatch('vtt:chat:message-sent', { text: `(Out of character: ${character.name} skips the rest and stays on watch.)`, senderName: character.name, timestamp: Date.now() });
    }
    setWaiting(true);
    dispatch('vtt:rest:choice', { resting, restType, hitDiceSpent });
  }

  function handleCancel() {
    setWaiting(false);
    dispatch('vtt:rest:cancel', {});
  }

  if (!open) return null;

  const hitDiceRemaining = Math.max(0, (character.level ?? 1) - (character.hitDiceUsed ?? 0));
  const dieSize    = HIT_DICE[character.class] ?? 8;
  const conMod     = modNum(character.stats.con);

  // ── Result view ──────────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="rest-modal">
        <div className="rest-modal-header">
          <span className="rest-modal-title">{result.restType === 'long' ? 'Long Rest' : 'Short Rest'}</span>
          <button className="rest-modal-close" onClick={() => setOpen(false)}>×</button>
        </div>

        <div className="rest-result">
          <div className="rest-result-hp">
            <span className="rest-result-hp-value">{result.currentHp} / {result.maxHp}</span>
            <span className="rest-result-hp-label">HP</span>
          </div>
          {(result.hpGained ?? 0) > 0 && (
            <p className="rest-result-gained">+{result.hpGained} HP recovered</p>
          )}
          {result.restType === 'long' && (
            <p className="rest-result-gained">Fully restored</p>
          )}
          {(result.maxSpellSlots1 ?? 0) > 0 && (
            <p className="rest-result-gained">
              Spell slots: {result.currentSpellSlots1} / {result.maxSpellSlots1}
            </p>
          )}
          {result.worldEvents && (
            <div className="rest-world-events">
              <p className="rest-world-events-label">While you slept…</p>
              <p className="rest-world-events-text">{result.worldEvents}</p>
            </div>
          )}
        </div>

        <div className="rest-footer">
          <button className="btn-primary" onClick={() => setOpen(false)}>Continue</button>
        </div>
      </div>
    );
  }

  // ── Selection view ───────────────────────────────────────────────────────────
  return (
    <div className="rest-modal">
      <div className="rest-modal-header">
        <span className="rest-modal-title">Rest</span>
        <button className="rest-modal-close" onClick={() => setOpen(false)}>×</button>
      </div>

      <p className="rest-modal-desc">
        Decide between a Long rest and a short one. A long rest takes around 8 hours, a short one takes 1 hour.
      </p>

      <div className="rest-party">
        {party.map(member => {
          const isSelf      = member.id === character.id;
          const tokenCharId = member.tokenPath ? (member.tokenPath.split('/')[1] ?? member.id) : member.id;
          const tokenUrl    = `${API}/api/campaigns/${character.campaignId}/party/${tokenCharId}/token`;
          const tokenBroken = brokenTokens.has(member.id);

          return (
            <div key={member.id} className="rest-party-row">
              {tokenBroken
                ? <div className="rest-token rest-token--initial">{member.name[0]?.toUpperCase()}</div>
                : <img className="rest-token" src={tokenUrl} alt={member.name} onError={() => setBrokenTokens(prev => new Set(prev).add(member.id))} />
              }
              <div className="rest-member-info">
                <span className="rest-member-name">{member.name}</span>

                {isSelf && (
                  <div className="rest-controls">
                    <div className="rest-toggle-group">
                      <button className={`rest-toggle${resting ? ' rest-toggle--active' : ''}`} onClick={() => setResting(true)}>On</button>
                      <button className={`rest-toggle${!resting ? ' rest-toggle--active' : ''}`} onClick={() => setResting(false)}>Off</button>
                    </div>
                    <div className="rest-toggle-group">
                      <button className={`rest-toggle${resting && restType === 'short' ? ' rest-toggle--active' : ''}`} onClick={() => setRestType('short')} disabled={!resting}>Short</button>
                      <button className={`rest-toggle${resting && restType === 'long' ? ' rest-toggle--active' : ''}`} onClick={() => setRestType('long')} disabled={!resting}>Long</button>
                    </div>
                  </div>
                )}

                {isSelf && resting && restType === 'short' && (
                  <div className="rest-hitdice">
                    <span className="rest-hitdice-label">Hit Dice (d{dieSize}{conMod >= 0 ? `+${conMod}` : conMod} each)</span>
                    <div className="rest-hitdice-controls">
                      <button className="rest-hitdice-btn" onClick={() => setHitDiceSpent(Math.max(0, hitDiceSpent - 1))}>−</button>
                      <span className="rest-hitdice-count">{hitDiceSpent}</span>
                      <button className="rest-hitdice-btn" onClick={() => setHitDiceSpent(Math.min(hitDiceRemaining, hitDiceSpent + 1))}>+</button>
                      <span className="rest-hitdice-max">/ {hitDiceRemaining}</span>
                    </div>
                  </div>
                )}
              </div>

              {!isSelf && <span className="rest-member-status">Sets their own</span>}
            </div>
          );
        })}
      </div>

      <div className="rest-footer">
        <button className="btn-primary" onClick={handleStart} disabled={waiting}>
          {waiting ? 'Waiting for other players' : 'Start Rest'}
        </button>
        {waiting && (
          <button className="btn-secondary" onClick={handleCancel} disabled={allCommitted}>
            Changed my mind
          </button>
        )}
      </div>
    </div>
  );
}
