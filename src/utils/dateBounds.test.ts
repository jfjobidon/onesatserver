// Mirror of the 13 test cases in onesatclient/docs/specs-for-server.md
// (section "createCampaign — date validation"). When you add a case there,
// add it here too — the table is the source of truth.
import { describe, it, expect } from 'vitest'
import { validateCampaignDates } from './dateBounds.js'
import {
  MAX_CAMPAIGN_START_AHEAD_MS,
  MAX_CAMPAIGN_DURATION_MS,
  MIN_CAMPAIGN_DURATION_MS,
  STARTING_DATE_GRACE_MS,
} from '../config/AppConfig.js'

const NOW = new Date('2026-04-27T12:00:00.000Z')

// Helpers — read the dates table without mental arithmetic.
const offset = (ms: number) => new Date(NOW.getTime() + ms)
const seconds = (n: number) => n * 1000
const days = (n: number) => n * 24 * 60 * 60 * 1000

describe('validateCampaignDates', () => {
  // Case #1 — happy path
  it('returns null for a valid +1d / +8d window', () => {
    const start = offset(days(1))
    const end = offset(days(8))
    expect(validateCampaignDates(start, end, NOW)).toBeNull()
  })

  // Case #2 — within 60s grace window
  it('returns null when start is 30s in the past (within grace)', () => {
    const start = offset(-seconds(30))
    const end = offset(days(8))
    expect(validateCampaignDates(start, end, NOW)).toBeNull()
  })

  // Case #3 — past beyond grace
  it('returns "must be now or in the future" when start is 90s in the past', () => {
    const start = offset(-seconds(90))
    const end = offset(days(8))
    expect(validateCampaignDates(start, end, NOW)).toBe(
      'Start date must be now or in the future',
    )
  })

  // Case #4 — exact grace boundary (strictly less than)
  it('returns null at exact -60s grace boundary (boundary uses < not <=)', () => {
    const start = offset(-STARTING_DATE_GRACE_MS) // exactly -60_000 ms
    const end = offset(days(8))
    expect(validateCampaignDates(start, end, NOW)).toBeNull()
  })

  // Case #5 — exact 6-month cap (strictly greater than)
  it('returns null at exact +6 months ahead boundary', () => {
    const start = offset(MAX_CAMPAIGN_START_AHEAD_MS) // exactly the cap
    const end = new Date(start.getTime() + 60 * 60 * 1000) // +1h end
    expect(validateCampaignDates(start, end, NOW)).toBeNull()
  })

  // Case #6 — 1ms over the 6-month cap
  it('returns "more than 6 months from now" at +6 months + 1ms', () => {
    const start = offset(MAX_CAMPAIGN_START_AHEAD_MS + 1)
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    expect(validateCampaignDates(start, end, NOW)).toBe(
      'Start date cannot be more than 6 months from now',
    )
  })

  // Case #7 — end equal to start
  it('returns "End date must be after start date" when end === start', () => {
    const start = offset(days(1))
    const end = new Date(start.getTime())
    expect(validateCampaignDates(start, end, NOW)).toBe(
      'End date must be after start date',
    )
  })

  // Case #8 — end before start
  it('returns "End date must be after start date" when end < start', () => {
    const start = offset(days(1))
    const end = offset(0) // before start (which is +1d)
    expect(validateCampaignDates(start, end, NOW)).toBe(
      'End date must be after start date',
    )
  })

  // Case #9 — exact 1-year duration
  it('returns null at exact 1-year duration boundary', () => {
    const start = offset(days(1))
    const end = new Date(start.getTime() + MAX_CAMPAIGN_DURATION_MS)
    expect(validateCampaignDates(start, end, NOW)).toBeNull()
  })

  // Case #10 — 1ms over 1-year duration
  it('returns "duration cannot exceed 1 year" at duration + 1ms', () => {
    const start = offset(days(1))
    const end = new Date(start.getTime() + MAX_CAMPAIGN_DURATION_MS + 1)
    expect(validateCampaignDates(start, end, NOW)).toBe(
      'Campaign duration cannot exceed 1 year',
    )
  })

  // Case #11 — exact 5-minute minimum duration boundary
  it('returns null at exact 5-minute minimum duration boundary', () => {
    const start = offset(days(1))
    const end = new Date(start.getTime() + MIN_CAMPAIGN_DURATION_MS) // exactly the floor
    expect(validateCampaignDates(start, end, NOW)).toBeNull()
  })

  // Case #12 — 1ms below 5-minute minimum duration
  it('returns "must be at least 5 minutes" at duration - 1ms', () => {
    const start = offset(days(1))
    const end = new Date(start.getTime() + MIN_CAMPAIGN_DURATION_MS - 1)
    expect(validateCampaignDates(start, end, NOW)).toBe(
      'Campaign duration must be at least 5 minutes',
    )
  })

  // Case #13 — invalid start
  it('returns "Invalid starting date format" for NaN start', () => {
    const start = new Date('garbage') // NaN
    const end = offset(days(7))
    expect(validateCampaignDates(start, end, NOW)).toBe(
      'Invalid starting date format',
    )
  })

  // Case #14 — invalid end (start valid)
  it('returns "Invalid ending date format" for NaN end', () => {
    const start = offset(days(1))
    const end = new Date('garbage')
    expect(validateCampaignDates(start, end, NOW)).toBe(
      'Invalid ending date format',
    )
  })

  // Case #15 — both invalid → start checked first
  it('returns "Invalid starting date format" when both are NaN (start checked first)', () => {
    const start = new Date('garbage')
    const end = new Date('garbage')
    expect(validateCampaignDates(start, end, NOW)).toBe(
      'Invalid starting date format',
    )
  })
})
