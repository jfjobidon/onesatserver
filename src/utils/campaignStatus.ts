// Single source of truth for "can this campaign accept votes right now?".
//
// Used by validateVote (and any future code path that needs to gate
// vote-related actions). Centralising this avoids drift between the cron's
// notion of "active" and the validator's notion of "acceptable to vote".
//
// Why a helper instead of "just check status === 'active'":
//   The cron flips `published → active` on a 60s tick. There's a window of
//   up to ~60s where `now >= startingDate` but the cron hasn't run yet —
//   the campaign is still `published` in Mongo. Without the slow-path
//   fallback below, voters in that window would be told "campaign hasn't
//   started yet" or similar, when in fact it has. The fast path covers
//   the common case (status='active') in one comparison, the slow path
//   covers the cron-not-yet-run window.

export type CampaignAcceptingVotesInput = {
  status: string
  paused: boolean
  startingDate: Date | string
  endingDate: Date | string
}

/**
 * Returns true iff the campaign currently accepts votes.
 *
 * Decision tree (first match wins):
 *   1. paused?                                    → false
 *   2. status === 'active'?                       → fast path: now <= endingDate
 *   3. status === 'published'?                    → slow path: now ∈ [startingDate, endingDate]
 *   4. anything else (draft / ready / ended / …)  → false
 *
 * The fast path still includes a date safety check because the cron flips
 * `active → ended` on a 60s tick too — between `now > endingDate` and the
 * next tick, `status` is still `active` but voting must already be closed.
 *
 * The slow path covers the symmetric window on the start side: between
 * `now >= startingDate` and the cron flipping `published → active`.
 *
 * Note that `paused` is a flag set independently of `status` — a campaign
 * can be `active AND paused` (the author hit emergency pause). Treated as
 * "not accepting votes" regardless of dates.
 */
export function isCampaignAcceptingVotes(
  campaign: CampaignAcceptingVotesInput,
  now: Date = new Date(),
): boolean {
  if (campaign.paused) return false

  const start = new Date(campaign.startingDate)
  const end = new Date(campaign.endingDate)
  const t = now.getTime()

  if (campaign.status === 'active') {
    // Fast path: active just means "between dates and not paused".
    // We've already checked `paused`. Date check is a safety net for the
    // cron-not-yet-run window on the end side.
    return t <= end.getTime()
  }

  if (campaign.status === 'published') {
    // Slow path: cron-not-yet-run window on the start side. The campaign
    // is technically supposed to be `active` already but Mongo hasn't
    // caught up yet. Accept votes only inside the date window.
    return t >= start.getTime() && t <= end.getTime()
  }

  // draft, ready, ended, or any other status — no votes.
  return false
}
