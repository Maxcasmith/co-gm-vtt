import { useEffect, useState } from 'react';
import type { Character } from 'shared';
import { on, dispatch } from './events.ts';
import { HIT_DICE } from './character-creation/srd.ts';

const API = `http://${window.location.hostname}:3001`;

function modNum(score: number) { return Math.floor((score - 10) / 2); }

type RestType = 'short' | 'long';
type PartyMember = Omit<Character, 'password'>;

interface RestResult {
  hpGained?: number;
  currentHp: number;
  maxHp: number;
  worldEvents?: string;
}

interface Props { character: Character }

export default function RestModal({ character }: Props) {
  const [open, setOpen]                 = useState(false);
  const [party, setParty]               = useState<PartyMember[]>([]);
  const [resting, setResting]           = useState(true);
  const [restType, setRestType]         = useState<RestType>('short');
  const [hitDiceSpent, setHitDiceSpent] = useState(0);
  const [brokenTokens, setBrokenTokens] = useState<Set<string>>(new Set());
  const [loading, setLoading]           = useState(false);
  const [result, setResult]             = useState<RestResult | null>(null);

  useEffect(() => on('vtt:rest:open', () => { setOpen(true); setResult(null); }), []);

  useEffect(() => {
    if (!open) return;
    setResting(true);
    setRestType('short');
    setHitDiceSpent(0);
    setResult(null);
    fetch(`${API}/api/campaigns/${character.campaignId}/party`)
      .then(r => r.json() as Promise<PartyMember[]>)
      .then(setParty)
      .catch(() => {});
  }, [open, character.campaignId]);

  async function handleStart() {
    if (!resting) {
      dispatch('vtt:chat:message-sent', { text: `(Out of character: ${character.name} skips the rest and stays on watch.)`, senderName: character.name, timestamp: Date.now() });
      setOpen(false);
      return;
    }

    setLoading(true);
    try {
      const endpoint = restType === 'long' ? 'long' : 'short';
      const r = await fetch(`${API}/api/campaigns/${character.campaignId}/rest/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: character.id, hitDiceSpent }),
      });
      const data = await r.json() as RestResult;
      setResult(data);
      dispatch('vtt:rest:result', { currentHp: data.currentHp, maxHp: data.maxHp, hpGained: data.hpGained, worldEvents: data.worldEvents });
    } catch {
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  const maxHitDice = 1;
  const dieSize    = HIT_DICE[character.class] ?? 8;
  const conMod     = modNum(character.stats.con);

  // ── Result view ──────────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="rest-modal">
        <div className="rest-modal-header">
          <span className="rest-modal-title">{restType === 'long' ? 'Long Rest' : 'Short Rest'}</span>
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
          {restType === 'long' && (
            <p className="rest-result-gained">Fully restored</p>
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
                      <button className="rest-hitdice-btn" onClick={() => setHitDiceSpent(Math.min(maxHitDice, hitDiceSpent + 1))}>+</button>
                      <span className="rest-hitdice-max">/ {maxHitDice}</span>
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
        <button className="btn-primary" onClick={() => void handleStart()} disabled={loading}>
          {loading ? 'Resting…' : 'Start Rest'}
        </button>
      </div>
    </div>
  );
}
