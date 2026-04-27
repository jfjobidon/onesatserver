// Mirror of onesatclient/utils/dateBounds.ts (to be created when client refactors
// the inline checks in CreateCampaignScreen). For now the source of truth on the
// client side is the inline logic in screens/CreateCampaignScreens/CreateCampaignScreen.tsx.
// keep in sync — update both in same commit
import {
  MAX_CAMPAIGN_START_AHEAD_MS,
  MAX_CAMPAIGN_DURATION_MS,
  STARTING_DATE_GRACE_MS,
} from '../config/AppConfig.js'

/**
 * Validates campaign dates. Returns an error message string, or null if valid.
 *
 * Pure function: no I/O, no side effects. `now` is injectable for tests.
 *
 * Order of checks matters — the first failing rule produces the user-facing
 * message, so the order determines UX message priority.
 */
export const validateCampaignDates = (
  startingDate: Date,
  endingDate: Date,
  now: Date = new Date()
): string | null => {
  // 1. Invalid Date format (e.g. new Date('not a date') → NaN getTime()).
  //    Without this, every comparison against NaN is false and bad input "passes".
  if (isNaN(startingDate.getTime())) {
    return 'Invalid starting date format'
  }
  if (isNaN(endingDate.getTime())) {
    return 'Invalid ending date format'
  }

  // 2. Start in the past (with grace window for clock skew / processing latency).
  if (startingDate.getTime() < now.getTime() - STARTING_DATE_GRACE_MS) {
    return 'Start date must be now or in the future'
  }

  // 3. Start too far ahead.
  if (startingDate.getTime() - now.getTime() > MAX_CAMPAIGN_START_AHEAD_MS) {
    return 'Start date cannot be more than 6 months from now'
  }

  // 4. End not strictly after start.
  if (endingDate.getTime() <= startingDate.getTime()) {
    return 'End date must be after start date'
  }

  // 5. Duration too long.
  if (endingDate.getTime() - startingDate.getTime() > MAX_CAMPAIGN_DURATION_MS) {
    return 'Campaign duration cannot exceed 1 year'
  }

  return null
}
