import { useEffect, useState } from 'react';
import type { ReactionOffer } from 'shared';
import { on } from './events';
import './styles/reaction-prompt.css';

interface Props {
  /** Answers the server. Declining and letting it time out are equivalent. */
  onRespond: (requestId: string, accepted: boolean) => void;
}

/**
 * Modal shown while the server holds an attack open waiting on a reaction (Shield).
 *
 * The countdown is real: when it reaches zero the server has already auto-declined, so the
 * prompt closes itself rather than sending a response that would arrive too late.
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

  const respond = (accepted: boolean) => {
    onRespond(offer.requestId, accepted);
    setOffer(null);
  };

  const secondsLeft = Math.ceil(msLeft / 1000);

  return (
    <div className="reaction-overlay">
      <div className="reaction-card">
        <p className="reaction-eyebrow">Reaction — {secondsLeft}s</p>
        <h2 className="reaction-title">Cast {offer.spellName}?</h2>
        <p className="reaction-detail">
          {offer.attackerName}&apos;s {offer.sourceName} hits AC {offer.currentAc} with {offer.attackTotal}.
        </p>
        <p className="reaction-outcome">
          {offer.spellName} raises your AC to {offer.boostedAc} — the attack would miss.
        </p>
        <div className="reaction-actions">
          <button className="reaction-accept" onClick={() => respond(true)}>
            Cast {offer.spellName}
          </button>
          <button className="reaction-decline" onClick={() => respond(false)}>
            Take the hit
          </button>
        </div>
      </div>
    </div>
  );
}
