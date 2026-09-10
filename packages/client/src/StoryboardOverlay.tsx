import { useEffect, useState } from 'react';
import type { StoryboardQueuePayload } from 'shared';
import { Button } from './components/Button/Button.tsx';

interface Props {
  queue: StoryboardQueuePayload;
  onDone: () => void;
  // Off for the shared session-opening cinematic (GamePage, driven by the server's 'storyboard:queue'
  // event — every connected player gets the same queue at the same time). Skipping there wouldn't
  // even sync to other clients (this component holds no socket, it's pure local state), but the
  // point is nobody should be able to cut a *shared* viewing short for themselves while everyone
  // else is still watching. On by default: every other caller (admin test sandbox, a character's
  // "Play Backstory" from their own sheet, or from a teammate's) is a lone viewer replaying on
  // their own client, where skipping only ever affects the person who clicked it.
  skippable?: boolean;
}

const API = `http://${window.location.hostname}:3001`;
const SLIDE_DURATION_MS = 12000;
// Must track the CSS transition-duration on .storyboard-curtain — the curtain's own opacity
// transition is what's actually playing; this is just how long we wait before calling onDone so
// the fade-to-black finishes on screen instead of getting cut off by the next view mounting.
const CURTAIN_FADE_MS = 1000;

// 'visible' = curtain lifted, slide showing. 'black' covers every other moment: the initial
// intro, the gap between two slides, and the outro — same curtain, same transition, reused for all
// three instead of a separate mechanism per case.
type Phase = 'visible' | 'black';

// Full-screen cold-open slideshow (RE2/RE3-style): plays each character's storyboard in the order
// the queue arrived in (server already sorted by createdAt), one slide at a time on a fixed timer,
// fading to black and back between every slide (and at the very start/end). Auto-advances with no
// per-slide manual control, per the "toggle it off in settings, otherwise it auto-advances"
// decision — the Skip button is the one exception, for leaving the whole sequence early.
export default function StoryboardOverlay({ queue, onDone, skippable = true }: Props) {
  const [charIndex, setCharIndex] = useState(0);
  const [slideIndex, setSlideIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('black');
  const [done, setDone] = useState(false);

  const entry = queue.entries[charIndex];
  const slide = entry?.slides[slideIndex];

  // Curtain lifts a beat after every slide change (including the very first) rather than on the
  // same tick — flipping the class immediately can get coalesced with the paint by the browser,
  // skipping the transition entirely instead of visibly fading in from black.
  useEffect(() => {
    const timer = setTimeout(() => setPhase('visible'), 50);
    return () => clearTimeout(timer);
  }, [charIndex, slideIndex]);

  // Owns advancing to the next slide. Deliberately does NOT depend on `phase` — it only sets phase,
  // never reads it, so flipping to 'black' here can't re-trigger this same effect and stack timers.
  useEffect(() => {
    if (!entry) { onDone(); return; } // nothing to show at all — skip the fade, there's nothing to fade from
    const showTimer = setTimeout(() => {
      setPhase('black'); // fade out
      const advanceTimer = setTimeout(() => {
        if (slideIndex + 1 < entry.slides.length) {
          setSlideIndex(i => i + 1);
        } else if (charIndex + 1 < queue.entries.length) {
          setCharIndex(i => i + 1);
          setSlideIndex(0);
        } else {
          setDone(true); // held on black — the fade-in effect above never fires again
        }
      }, CURTAIN_FADE_MS);
      return () => clearTimeout(advanceTimer);
    }, SLIDE_DURATION_MS);
    return () => clearTimeout(showTimer);
  }, [charIndex, slideIndex, entry, queue.entries.length, onDone]);

  // Held on black for the fade's full duration before actually handing off to whatever's next.
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(onDone, CURTAIN_FADE_MS);
    return () => clearTimeout(timer);
  }, [done, onDone]);

  if (!entry || !slide) return null;

  // Skips straight to the held-black/onDone path below — same as reaching the natural end, just
  // early. Any timer still pending from the normal advance effect gets cleared on unmount like
  // always; it can't fire anything visible once `done` is true (the curtain stays opaque regardless
  // of phase once done).
  function handleSkip() {
    setPhase('black');
    setDone(true);
  }

  return (
    <div className="encounter-overlay storyboard-overlay">
      <img key={`${charIndex}-${slideIndex}`} src={`${API}${slide.url}`} alt="" className="storyboard-slide" />
      <p key={`caption-${charIndex}-${slideIndex}`} className="storyboard-caption">{slide.caption}</p>
      <div className={`storyboard-curtain${phase === 'visible' && !done ? ' storyboard-curtain--lifted' : ''}`} />
      {skippable && <Button variant="ghost" className="storyboard-skip" onClick={handleSkip}>Skip</Button>}
    </div>
  );
}
