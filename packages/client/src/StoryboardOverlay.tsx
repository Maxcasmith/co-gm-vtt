import { useEffect, useState } from 'react';
import type { StoryboardQueuePayload } from 'shared';

interface Props {
  queue: StoryboardQueuePayload;
  onDone: () => void;
}

const API = `http://${window.location.hostname}:3001`;
const SLIDE_DURATION_MS = 12000;
// Must track the CSS transition-duration on .storyboard-curtain — the curtain's own opacity
// transition is what's actually playing; this is just how long we wait before calling onDone so
// the fade-to-black finishes on screen instead of getting cut off by the next view mounting.
const CURTAIN_FADE_MS = 1000;

type Phase = 'intro' | 'playing' | 'outro';

// Full-screen cold-open slideshow (RE2/RE3-style): plays each character's storyboard in the order
// the queue arrived in (server already sorted by createdAt), one slide at a time on a fixed timer —
// no manual skip, per the "toggle it off in settings, otherwise it auto-advances" decision.
export default function StoryboardOverlay({ queue, onDone }: Props) {
  const [charIndex, setCharIndex] = useState(0);
  const [slideIndex, setSlideIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('intro');

  const entry = queue.entries[charIndex];
  const slide = entry?.slides[slideIndex];

  // Curtain starts opaque (phase 'intro') and lifts a beat after mount, rather than lifting on the
  // very same tick — flipping the class immediately can get coalesced with the initial paint by the
  // browser, skipping the transition entirely instead of visibly fading up from black.
  useEffect(() => {
    const timer = setTimeout(() => setPhase('playing'), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!entry) { onDone(); return; }
    if (phase === 'outro') return;
    const timer = setTimeout(() => {
      if (slideIndex + 1 < entry.slides.length) {
        setSlideIndex(i => i + 1);
      } else if (charIndex + 1 < queue.entries.length) {
        setCharIndex(i => i + 1);
        setSlideIndex(0);
      } else {
        setPhase('outro');
      }
    }, SLIDE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [charIndex, slideIndex, entry, queue.entries.length, phase, onDone]);

  // Same curtain, opposite direction: dropping back to opaque at the end, held on screen for the
  // fade's full duration before actually handing off to whatever's next.
  useEffect(() => {
    if (phase !== 'outro') return;
    const timer = setTimeout(onDone, CURTAIN_FADE_MS);
    return () => clearTimeout(timer);
  }, [phase, onDone]);

  if (!entry || !slide) return null;

  return (
    <div className="encounter-overlay storyboard-overlay">
      <div className="storyboard-character-name">{entry.characterName}</div>
      <img key={`${charIndex}-${slideIndex}`} src={`${API}${slide.url}`} alt="" className="storyboard-slide" />
      <p key={`caption-${charIndex}-${slideIndex}`} className="storyboard-caption">{slide.caption}</p>
      <div className={`storyboard-curtain${phase === 'playing' ? ' storyboard-curtain--lifted' : ''}`} />
    </div>
  );
}
