import { PrismaClient } from '@prisma/client'
import { STATUS_CRON_INTERVAL_MS } from '../config/AppConfig.js'
import { DataSourcesMongo } from '../datasourcesmongo.js'

const prisma = new PrismaClient()
const dataSourcesMongo = new DataSourcesMongo()

// published → active when startingDate has been reached.
// updateMany returns count; no error if zero rows match.
async function promoteScheduledToActive(): Promise<number> {
  const now = new Date()
  const result = await prisma.campaign.updateMany({
    where: {
      status: 'published',
      startingDate: { lte: now },
    },
    data: { status: 'active', updatedDate: now },
  })
  return result.count
}

// active → ended : two-phase to close the voting window AS FAST AS POSSIBLE.
//
// Phase 1 (priority — fast path):
//   ONE atomic Mongo updateMany that flips every expired campaign from
//   `active` to `ended`. Takes ~10ms regardless of how many candidates
//   match. From this point on, validateVote rejects every incoming vote
//   for those campaigns (status check). The voting window is closed
//   even though settlement hasn't run yet.
//
// Phase 2 (background — slower):
//   For each campaign now in `ended` but with `settledAt IS NULL`, run
//   the full settlement (Redis aggregation, snapshot building, pubsub).
//   This can take seconds on a campaign with millions of votes — but
//   it doesn't matter because the voting window is already closed.
//
// Crash safety: if the cron dies between Phase 1 and Phase 2, the next
// tick picks up the orphans (status='ended' AND settledAt=null) and
// finishes the job. handleCampaignEnd is idempotent.
async function closeExpiredVotingWindows(): Promise<number> {
  const now = new Date()
  const result = await prisma.campaign.updateMany({
    where: {
      status: 'active',
      endingDate: { lt: now },
    },
    data: { status: 'ended', updatedDate: now },
  })
  return result.count
}

async function settleUnsettledEndedCampaigns(): Promise<number> {
  const candidates = await prisma.campaign.findMany({
    where: {
      status: 'ended',
      settledAt: null,
    },
    select: { id: true },
  })
  let settledCount = 0
  for (const { id } of candidates) {
    const res = await dataSourcesMongo.handleCampaignEnd(id)
    if (res.settledNow) settledCount += 1
  }
  return settledCount
}

async function tick(): Promise<void> {
  try {
    const promoted = await promoteScheduledToActive()
    // Phase 1 first — close voting windows in one shot.
    const closed = await closeExpiredVotingWindows()
    // Phase 2 — settle anything (newly closed AND any orphans from
    // a previous crashed tick).
    const settled = await settleUnsettledEndedCampaigns()
    if (promoted > 0 || closed > 0 || settled > 0) {
      console.log(`[statusCron] promoted=${promoted} closed=${closed} settled=${settled}`)
    }
  } catch (err) {
    console.log('[statusCron] tick error', err)
  }
}

let intervalHandle: NodeJS.Timeout | null = null

export function startCampaignStatusCron(): void {
  if (intervalHandle) return
  console.log(`[statusCron] starting, interval=${STATUS_CRON_INTERVAL_MS}ms`)
  // Run once immediately at startup so a freshly-launched server catches up,
  // then schedule the interval.
  tick()
  intervalHandle = setInterval(tick, STATUS_CRON_INTERVAL_MS)
}

export function stopCampaignStatusCron(): void {
  if (!intervalHandle) return
  clearInterval(intervalHandle)
  intervalHandle = null
}
