// L1 unit tests for isCampaignAcceptingVotes — pure function, no I/O.

import { describe, it, expect } from 'vitest'
import { isCampaignAcceptingVotes } from './campaignStatus.js'

const NOW = new Date('2026-05-02T12:00:00.000Z')
const HOUR_AGO = new Date(NOW.getTime() - 3_600_000)
const HOUR_LATER = new Date(NOW.getTime() + 3_600_000)
const MINUTE_AGO = new Date(NOW.getTime() - 60_000)
const MINUTE_LATER = new Date(NOW.getTime() + 60_000)

describe('isCampaignAcceptingVotes — paused', () => {
  it('returns false when paused regardless of status or dates', () => {
    expect(
      isCampaignAcceptingVotes(
        { status: 'active', paused: true, startingDate: HOUR_AGO, endingDate: HOUR_LATER },
        NOW,
      ),
    ).toBe(false)
  })

  it('returns false when paused even on a published campaign in window', () => {
    expect(
      isCampaignAcceptingVotes(
        { status: 'published', paused: true, startingDate: HOUR_AGO, endingDate: HOUR_LATER },
        NOW,
      ),
    ).toBe(false)
  })
})

describe('isCampaignAcceptingVotes — fast path (status=active)', () => {
  it('accepts when active and now <= endingDate', () => {
    expect(
      isCampaignAcceptingVotes(
        { status: 'active', paused: false, startingDate: HOUR_AGO, endingDate: HOUR_LATER },
        NOW,
      ),
    ).toBe(true)
  })

  it('rejects when active but now > endingDate (cron-not-yet-run on end side)', () => {
    expect(
      isCampaignAcceptingVotes(
        { status: 'active', paused: false, startingDate: HOUR_AGO, endingDate: MINUTE_AGO },
        NOW,
      ),
    ).toBe(false)
  })

  it('accepts at exactly endingDate (boundary inclusive)', () => {
    expect(
      isCampaignAcceptingVotes(
        { status: 'active', paused: false, startingDate: HOUR_AGO, endingDate: NOW },
        NOW,
      ),
    ).toBe(true)
  })

  it('does not check startingDate on the fast path (cron has already promoted)', () => {
    // status='active' implies the cron already promoted, so startingDate is moot.
    // Even if startingDate is in the future (which would be inconsistent state),
    // we trust the status flag.
    expect(
      isCampaignAcceptingVotes(
        { status: 'active', paused: false, startingDate: HOUR_LATER, endingDate: new Date(HOUR_LATER.getTime() + 3_600_000) },
        NOW,
      ),
    ).toBe(true)
  })
})

describe('isCampaignAcceptingVotes — slow path (status=published, cron-not-yet-run)', () => {
  it('accepts when published and now ∈ [startingDate, endingDate]', () => {
    expect(
      isCampaignAcceptingVotes(
        { status: 'published', paused: false, startingDate: HOUR_AGO, endingDate: HOUR_LATER },
        NOW,
      ),
    ).toBe(true)
  })

  it('rejects when published and now < startingDate (genuine pre-start)', () => {
    expect(
      isCampaignAcceptingVotes(
        { status: 'published', paused: false, startingDate: MINUTE_LATER, endingDate: HOUR_LATER },
        NOW,
      ),
    ).toBe(false)
  })

  it('rejects when published and now > endingDate (impossible state in practice but safe)', () => {
    expect(
      isCampaignAcceptingVotes(
        { status: 'published', paused: false, startingDate: new Date(HOUR_AGO.getTime() - 3_600_000), endingDate: HOUR_AGO },
        NOW,
      ),
    ).toBe(false)
  })

  it('accepts at exactly startingDate (boundary inclusive)', () => {
    expect(
      isCampaignAcceptingVotes(
        { status: 'published', paused: false, startingDate: NOW, endingDate: HOUR_LATER },
        NOW,
      ),
    ).toBe(true)
  })

  it('accepts at exactly endingDate (boundary inclusive)', () => {
    expect(
      isCampaignAcceptingVotes(
        { status: 'published', paused: false, startingDate: HOUR_AGO, endingDate: NOW },
        NOW,
      ),
    ).toBe(true)
  })
})

describe('isCampaignAcceptingVotes — other statuses', () => {
  it.each(['draft', 'ready', 'ended', 'unknown', ''])(
    'returns false for status=%s regardless of dates',
    (status) => {
      expect(
        isCampaignAcceptingVotes(
          { status, paused: false, startingDate: HOUR_AGO, endingDate: HOUR_LATER },
          NOW,
        ),
      ).toBe(false)
    },
  )
})

describe('isCampaignAcceptingVotes — input format', () => {
  it('accepts ISO string dates', () => {
    expect(
      isCampaignAcceptingVotes(
        {
          status: 'active',
          paused: false,
          startingDate: HOUR_AGO.toISOString(),
          endingDate: HOUR_LATER.toISOString(),
        },
        NOW,
      ),
    ).toBe(true)
  })

  it('defaults `now` to wall clock when omitted', () => {
    // Just checks the function runs and returns a boolean — exact value
    // depends on wall clock so we don't assert.
    const result = isCampaignAcceptingVotes({
      status: 'active',
      paused: false,
      startingDate: new Date(Date.now() - 1000),
      endingDate: new Date(Date.now() + 1000),
    })
    expect(typeof result).toBe('boolean')
  })
})
