// Integration tests for the createCampaign mutation.
// Exercises the full chain: Apollo → resolver (mutations.ts) → datasource
// (datasourcesmongo.ts) → Prisma → MongoDB Docker (osov-mongo-test, port 27018).
// Auth is faked by injecting `userId` directly into contextValue.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import {
  getTestServer,
  prismaTest,
  cleanupDatabase,
  createTestUser,
  executeAsUser,
  unwrap,
} from './setup.js'
import {
  MAX_CAMPAIGN_DURATION_MS,
  MIN_CAMPAIGN_DURATION_MS,
} from '../../src/config/AppConfig.js'

const CREATE_CAMPAIGN = `
  mutation CreateCampaign($campaignInput: CampaignInput) {
    createCampaign(campaignInput: $campaignInput) {
      code
      success
      message
      campaign {
        id
        authorId
        title
        description
        status
        isPrivate
        minSatPerVote
        maxSatPerVote
        suggestedSatPerVote
        blindAmount
        blindRank
        blindVote
        allowMultipleVotes
        creationDate
        startingDate
        endingDate
        paused
      }
    }
  }
`

const validInput = (overrides: Partial<Record<string, any>> = {}) => {
  // Build a payload that passes every validation, with sane defaults.
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000) // +1 day
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000) // +7 days
  return {
    title: 'Integration Test Campaign',
    description: 'Created by an automated integration test',
    startingDate: start.getTime(),
    endingDate: end.getTime(),
    minSatPerVote: 1,
    maxSatPerVote: 10,
    suggestedSatPerVote: 5,
    isPrivate: false,
    blindAmount: false,
    blindRank: false,
    blindVote: false,
    allowMultipleVotes: false,
    ...overrides,
  }
}

let server: Awaited<ReturnType<typeof getTestServer>>

beforeAll(async () => {
  server = await getTestServer()
  await cleanupDatabase()
})

beforeEach(async () => {
  await cleanupDatabase()
})

afterAll(async () => {
  // Disconnect Prisma so vitest exits cleanly. The cached Apollo server has
  // no httpServer to drain, so no explicit shutdown is required.
  await prismaTest.$disconnect()
})

describe('createCampaign mutation (integration)', () => {
  // 1. Auth missing
  it('rejects with UNAUTHENTICATED when no userId is in context', async () => {
    const res = await executeAsUser(server, CREATE_CAMPAIGN, { campaignInput: validInput() }, null)
    const result = unwrap(res)
    expect(result.errors).toBeDefined()
    expect(result.errors[0].extensions.code).toBe('UNAUTHENTICATED')
  })

  // 2. Happy path — DB persistence verified
  it('creates a draft campaign on the happy path and persists it', async () => {
    const user = await createTestUser()
    const input = validInput()

    const res = await executeAsUser(server, CREATE_CAMPAIGN, { campaignInput: input }, user.uid)
    const result = unwrap(res)
    expect(result.errors).toBeUndefined()
    expect(result.data.createCampaign.code).toBe('200')
    expect(result.data.createCampaign.success).toBe(true)
    expect(result.data.createCampaign.campaign.status).toBe('draft')
    expect(result.data.createCampaign.campaign.isPrivate).toBe(false)
    expect(result.data.createCampaign.campaign.authorId).toBe(user.uid)
    expect(result.data.createCampaign.campaign.paused).toBe(false)

    // Round-trip the persisted record through Prisma — proves the database
    // received the same values, not just that the resolver echoed them.
    const persisted = await prismaTest.campaign.findUnique({
      where: { id: result.data.createCampaign.campaign.id },
    })
    expect(persisted).toBeTruthy()
    expect(persisted!.title).toBe(input.title)
    expect(persisted!.status).toBe('draft')
    expect(persisted!.isPrivate).toBe(false)
    expect(persisted!.authorId).toBe(user.uid)
    expect(persisted!.minSatPerVote).toBe(1)
    expect(persisted!.maxSatPerVote).toBe(10)
    expect(persisted!.suggestedSatPerVote).toBe(5)
  })

  // 3. isPrivate: true is propagated
  it('persists isPrivate=true when sent', async () => {
    const user = await createTestUser()
    const res = await executeAsUser(
      server,
      CREATE_CAMPAIGN,
      { campaignInput: validInput({ isPrivate: true }) },
      user.uid,
    )
    const result = unwrap(res)
    expect(result.data.createCampaign.success).toBe(true)
    expect(result.data.createCampaign.campaign.isPrivate).toBe(true)

    const persisted = await prismaTest.campaign.findUnique({
      where: { id: result.data.createCampaign.campaign.id },
    })
    expect(persisted!.isPrivate).toBe(true)
  })

  // 4. Invalid date format → delegates to validateCampaignDates
  it('rejects with "Invalid starting date format" for NaN start', async () => {
    const user = await createTestUser()
    const res = await executeAsUser(
      server,
      CREATE_CAMPAIGN,
      { campaignInput: validInput({ startingDate: 'garbage' }) },
      user.uid,
    )
    const result = unwrap(res)
    expect(result.data.createCampaign.code).toBe('400')
    expect(result.data.createCampaign.success).toBe(false)
    expect(result.data.createCampaign.message).toBe('Invalid starting date format')
    expect(result.data.createCampaign.campaign).toBeNull()
  })

  // 5. Start in the past
  it('rejects start in the past (beyond grace window)', async () => {
    const user = await createTestUser()
    const past = Date.now() - 5 * 60 * 1000 // -5 min
    const res = await executeAsUser(
      server,
      CREATE_CAMPAIGN,
      { campaignInput: validInput({ startingDate: past, endingDate: past + 7 * 24 * 60 * 60 * 1000 }) },
      user.uid,
    )
    const result = unwrap(res)
    expect(result.data.createCampaign.code).toBe('400')
    expect(result.data.createCampaign.message).toBe('Start date must be now or in the future')
  })

  // 6. Duration over 1 year
  it('rejects duration over 1 year', async () => {
    const user = await createTestUser()
    const start = Date.now() + 24 * 60 * 60 * 1000 // +1d
    const end = start + MAX_CAMPAIGN_DURATION_MS + 60 * 1000 // +1d + 1y + 1min
    const res = await executeAsUser(
      server,
      CREATE_CAMPAIGN,
      { campaignInput: validInput({ startingDate: start, endingDate: end }) },
      user.uid,
    )
    const result = unwrap(res)
    expect(result.data.createCampaign.code).toBe('400')
    expect(result.data.createCampaign.message).toBe('Campaign duration cannot exceed 1 year')
  })

  // 6b. Duration exactly at the 5-minute minimum (boundary, succeeds)
  it('accepts duration exactly at the 5-minute minimum', async () => {
    const user = await createTestUser()
    const start = Date.now() + 24 * 60 * 60 * 1000 // +1d
    const end = start + MIN_CAMPAIGN_DURATION_MS // exactly 5 min after start
    const res = await executeAsUser(
      server,
      CREATE_CAMPAIGN,
      { campaignInput: validInput({ startingDate: start, endingDate: end }) },
      user.uid,
    )
    const result = unwrap(res)
    expect(result.data.createCampaign.code).toBe('200')
    expect(result.data.createCampaign.success).toBe(true)
  })

  // 6c. Duration 1ms under the 5-minute minimum
  it('rejects duration under 5 minutes', async () => {
    const user = await createTestUser()
    const start = Date.now() + 24 * 60 * 60 * 1000 // +1d
    const end = start + MIN_CAMPAIGN_DURATION_MS - 1 // 1ms below the floor
    const res = await executeAsUser(
      server,
      CREATE_CAMPAIGN,
      { campaignInput: validInput({ startingDate: start, endingDate: end }) },
      user.uid,
    )
    const result = unwrap(res)
    expect(result.data.createCampaign.code).toBe('400')
    expect(result.data.createCampaign.success).toBe(false)
    expect(result.data.createCampaign.message).toBe('Campaign duration must be at least 5 minutes')
  })

  // 7. campaignInput absent
  it('rejects with BAD_USER_INPUT when campaignInput is null', async () => {
    const user = await createTestUser()
    const res = await executeAsUser(
      server,
      CREATE_CAMPAIGN,
      { campaignInput: null },
      user.uid,
    )
    const result = unwrap(res)
    expect(result.errors).toBeDefined()
    expect(result.errors[0].extensions.code).toBe('BAD_USER_INPUT')
  })

  // 8. User uid does not exist in DB
  it('returns 404 "User not found" when authorId has no User record', async () => {
    // Don't call createTestUser() — submit with a uid that's not in the DB.
    const res = await executeAsUser(
      server,
      CREATE_CAMPAIGN,
      { campaignInput: validInput() },
      'ghost-uid-does-not-exist',
    )
    const result = unwrap(res)
    expect(result.data.createCampaign.code).toBe('404')
    expect(result.data.createCampaign.success).toBe(false)
    expect(result.data.createCampaign.message).toBe('User not found')
  })
})
