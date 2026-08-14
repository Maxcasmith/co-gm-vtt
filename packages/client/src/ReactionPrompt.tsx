import { useEffect, useState, type CSSProperties } from 'react';
import type { ReactionOffer } from 'shared';
import { on } from './events';
import './styles/reaction-prompt.css';

interface Props {
  /** Answers the server with the chosen option's spellName, or null to decline. */
  onRespond: (requestId: string, spellName: string | null) => void;
}

/**
 * Sidebar shown while the server holds an attack/damage event open waiting on a reaction —
 * lists every reaction spell currently eligible, not just one, since a single hit can make more
 * than one of a player's known reactions (Shield, Hellish Rebuke, ...) usable at once.
 *
 * The countdown is real: when it reaches zero the server has already auto-declined, so the
 * panel closes itself rather than sending a response that would arrive too late.
 */
export default function ReactionPrompt({ onRespond }: Props) {
  const [offer, setOffer] = useState<ReactionOffer | null>(null);
  const [msLeft, setMsLeft] = useState(0);

  useEffect(() => on('vtt:combat:reaction:offer', payload => {
    setOffer(payload);
    setMsLeft(payload.expiresInMs);
  }), []);

  // The server withdrew the offer (timed out on its side) — drop it without answering.
  useEffect(() => on('vtt:combat:reaction:close', ({ requestId }) => {
    setOffer(prev => (prev?.requestId === requestId ? null : prev));
  }), []);

  useEffect(() => {
    if (!offer) return;
    const tick = setInterval(() => {
      setMsLeft(prev => {
        const next = prev - 100;
        if (next <= 0) { setOffer(null); return 0; }
        return next;
      });
    }, 100);
    return () => clearInterval(tick);
  }, [offer]);

  if (!offer) return null;

  const respond = (spellName: string | null) => {
    onRespond(offer.requestId, spellName);
    setOffer(null);
  };

  const secondsLeft = Math.ceil(msLeft / 1000);
  const pct = (msLeft / offer.expiresInMs) * 100;

  return (
    <div className="reaction-sidebar">
      <div className="reaction-sidebar-header">
        <p className="reaction-eyebrow">Reaction — {secondsLeft}s</p>
        <div className="reaction-timer-track">
          <div className="reaction-timer-fill" style={{ '--pct': pct } as CSSProperties} />
        </div>
      </div>

      <div className="reaction-options">
        {offer.options.map(option => (
          <div className="reaction-option" key={option.spellName}>
            <h3 className="reaction-option-title">{option.spellName}</h3>
            {option.kind === 'defend' ? (
              <>
                <p className="reaction-detail">
                  {option.attackerName}&apos;s {option.sourceName} hits AC {option.currentAc} with {option.attackTotal}.
                </p>
                <p className="reaction-outcome">
                  Raises your AC to {option.boostedAc} — the attack would miss.
                </p>
              </>
            ) : option.kind === 'opportunity' ? (
              <p className="reaction-detail">
                {option.sourceName} is moving out of your reach. Strike now, before it's gone?
              </p>
            ) : (
              <p className="reaction-detail">
                {option.attackerName}&apos;s {option.sourceName} just hit you. Strike back?
              </p>
            )}
            <button className="reaction-accept" onClick={() => respond(option.spellName)}>
              {option.kind === 'opportunity' ? 'Attack' : `Cast ${option.spellName}`}
            </button>
          </div>
        ))}
      </div>

      <button className="reaction-decline" onClick={() => respond(null)}>
        Take the hit
      </button>
    </div>
  );
}
