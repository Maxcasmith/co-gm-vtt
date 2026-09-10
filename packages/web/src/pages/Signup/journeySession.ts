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

const PENDING_CAMPAIGN_TAGS_KEY = 'pending-campaign-tags';

// Separate key from JourneySelection above: that one is consumed the moment the signup
// journey mounts, but these tags need to survive the whole journey and are only read
// once signup actually completes (see Signup.tsx submit()).
export function writePendingCampaignTags(tags: string[]) {
  try {
    sessionStorage.setItem(PENDING_CAMPAIGN_TAGS_KEY, JSON.stringify(tags));
  } catch {
    // sessionStorage unavailable — the post-signup redirect just falls back to /profile
  }
}

export function consumePendingCampaignTags(): string[] {
  try {
    const raw = sessionStorage.getItem(PENDING_CAMPAIGN_TAGS_KEY);
    sessionStorage.removeItem(PENDING_CAMPAIGN_TAGS_KEY);
    return raw ? JSON.parse(raw) as string[] : [];
  } catch {
    return [];
  }
}
