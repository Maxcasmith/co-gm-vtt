import type { SignupForm } from './journeyForm';

const SESSION_KEY = 'journey-selection';

export type JourneySelection = Partial<Pick<SignupForm, 'productId' | 'googleCode'>>;

// One-shot handoff from the Products page into the signup journey — written right
// before navigating to /signup, read (and cleared) once the journey mounts.
export function writeJourneySelection(selection: JourneySelection) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(selection));
  } catch {
    // sessionStorage unavailable (private mode, quota, etc.) — the journey just starts blank
  }
}

export function consumeJourneySelection(): JourneySelection {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    return raw ? JSON.parse(raw) as JourneySelection : {};
  } catch {
    return {};
  }
}
