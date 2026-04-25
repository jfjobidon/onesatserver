import { PrismaClient } from '@prisma/client'
import { STATUS_CRON_INTERVAL_MS } from '../config/AppConfig.js'

const prisma = new PrismaClient()

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

// active → ended when endingDate has been passed.
async function demoteActiveToEnded(): Promise<number> {
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

async function tick(): Promise<void> {
  try {
    const promoted = await promoteScheduledToActive()
    const demoted = await demoteActiveToEnded()
    if (promoted > 0 || demoted > 0) {
      console.log(`[statusCron] promoted=${promoted} demoted=${demoted}`)
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
