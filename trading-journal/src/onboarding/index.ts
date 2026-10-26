/**
 * First-run tour (P13). Mount `<OnboardingHost/>` once in `App`; `OnboardingCard` goes into the settings page. The tour
 * itself is a lazy chunk. See README.md.
 */
export { OnboardingHost } from "./OnboardingHost";
export { OnboardingCard, ONBOARDING_CARD, onboardingStatusText } from "./OnboardingCard";
export {
  useOnboarding,
  startOnboarding,
  skipOnboarding,
  finishOnboarding,
  pauseOnboarding,
  resumeOnboarding,
  readOnboarding,
  markSeen,
  autoStartDecision,
  ONBOARDING_KEY,
  STEP_IDS,
  STEP_COUNT,
  type StoredOnboarding,
  type OnboardingStatus,
} from "./onboardingStore";
