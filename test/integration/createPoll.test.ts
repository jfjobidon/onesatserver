// Integration tests for the createPoll mutation.
// Mirrors the test cases listed in onesatclient/docs/specs-for-server.md
// section "createPoll — author-only + sat/privacy inheritance + status check".
//
// Auth is faked by injecting `userId` directly into contextValue (see setup.ts).

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import {
  getTestServer,
  prismaTest,
  cleanupDatabase,
  createTestUser,
  createTestCampaign,
  executeAsUser,
  unwrap,
} from './setup.js'

const CREATE_POLL = `
  mutation CreatePoll($pollInput: PollInput) {
    createPoll(pollInput: $pollInput) {
      code
      success
      message
      poll {
        id
        campaignId
        authorId
        title
        description
        paused
        minSatPerVote
        maxSatPerVote
        suggestedSatPerVote
        blindAmount
        blindRank
        blindVote
        allowMultipleVotes
      }
    }
  }
`

const validInput = (campaignId: string, overrides: Partial<Record<string, any>> = {}) => ({
  campaignId,
  title: `Poll ${Date.now()}-${Math.random()}`,
  description: 'Created by createPoll integration test',
  minSatPerVote: 1,
  maxSatPerVote: 10,
  suggestedSatPerVote: 5,
  blindAmount: false,
  blindRank: false,
  blindVote: false,
  allowMultipleVotes: false,
  ...overrides,
})

let server: Awaited<ReturnType<typeof getTestServer>>

beforeAll(async () => {
  server = await getTestServer()
  await cleanupDatabase()
})

beforeEach(async () => {
  await cleanupDatabase()
})

afterAll(async () => {
  await prismaTest.$disconnect()
})

describe('createPoll mutation (integration)', () => {
  // 1. Auth missing
  it('rejects with UNAUTHENTICATED when no userId is in context', async () => {
    const author = await createTestUser()
    const campaign = await createTestCampaign(author.uid)
    const res = await executeAsUser(server, CREATE_POLL, { pollInput: validInput(campaign.id) }, null)
    const result = unwrap(res)
    expect(result.errors).toBeDefined()
    expect(result.errors[0].extensions.code).toBe('UNAUTHENTICATED')
  })

  // 2. Happy path — DB persistence verified
  it('creates a poll on the happy path and persists titleLower lowercased', async () => {
    const author = await createTestUser()
    const campaign = await createTestCampaign(author.uid)
    const input = validInput(campaign.id, { title: 'Best Pizza' })

    const res = await executeAsUser(server, CREATE_POLL, { pollInput: input }, author.uid)
    const result = unwrap(res)
    expect(result.errors).toBeUndefined()
    expect(result.data.createPoll.code).toBe('200')
    expect(result.data.createPoll.success).toBe(true)
    expect(result.data.createPoll.poll.title).toBe('Best Pizza') // casing preserved
    expect(result.data.createPoll.poll.authorId).toBe(author.uid)

    const persisted = await prismaTest.poll.findUnique({
      where: { id: result.data.createPoll.poll.id },
    })
    expect(persisted).toBeTruthy()
    expect(persisted!.title).toBe('Best Pizza')
    expect(persisted!.titleLower).toBe('best pizza')
    expect(persisted!.campaignId).toBe(campaign.id)
    expect(persisted!.authorId).toBe(author.uid)
  })

  // 3. Campaign not found
  it('returns 404 "Campaign not found" when campaignId does not exist', async () => {
    const author = await createTestUser()
    // Use a random ObjectId (24 hex chars) that's not in the DB
    const fakeId = '0000a0a0a0a0a0a0a0a0a0a0'
    const res = await executeAsUser(
      server,
      CREATE_POLL,
      { pollInput: validInput(fakeId) },
      author.uid,
    )
    const result = unwrap(res)
    expect(result.data.createPoll.code).toBe('404')
    expect(result.data.createPoll.message).toBe('Campaign not found')
  })

  // 4. Different user (not the campaign author)
  it('returns 403 when the caller is not the campaign author', async () => {
    const author = await createTestUser()
    const otherUser = await createTestUser()
    const campaign = await createTestCampaign(author.uid)
    const res = await executeAsUser(
      server,
      CREATE_POLL,
      { pollInput: validInput(campaign.id) },
      otherUser.uid,
    )
    const result = unwrap(res)
    expect(result.data.createPoll.code).toBe('403')
    expect(result.data.createPoll.message).toBe('Only the campaign author can add a poll')
  })

  // 5. Campaign already published — status check
  it('returns 409 when the campaign is published', async () => {
    const author = await createTestUser()
    const campaign = await createTestCampaign(author.uid, { status: 'published' })
    const res = await executeAsUser(
      server,
      CREATE_POLL,
      { pollInput: validInput(campaign.id) },
      author.uid,
    )
    const result = unwrap(res)
    expect(result.data.createPoll.code).toBe('409')
    expect(result.data.createPoll.message).toBe('Cannot add a poll to a published campaign')
  })

  // 6. Campaign already ended — status check
  it('returns 409 when the campaign is ended', async () => {
    const author = await createTestUser()
    const campaign = await createTestCampaign(author.uid, { status: 'ended' })
    const res = await executeAsUser(
      server,
      CREATE_POLL,
      { pollInput: validInput(campaign.id) },
      author.uid,
    )
    const result = unwrap(res)
    expect(result.data.createPoll.code).toBe('409')
    expect(result.data.createPoll.message).toBe('Cannot add a poll to an ended campaign')
  })

  // 7. Sat inheritance — poll.min < campaign.min
  it('rejects poll.minSatPerVote below campaign.minSatPerVote', async () => {
    const author = await createTestUser()
    // Campaign minimum 5; poll asks for minimum 1.
    const campaign = await createTestCampaign(author.uid, { minSatPerVote: 5, maxSatPerVote: 100, suggestedSatPerVote: 10 })
    const res = await executeAsUser(
      server,
      CREATE_POLL,
      { pollInput: validInput(campaign.id, { minSatPerVote: 1, maxSatPerVote: 50, suggestedSatPerVote: 10 }) },
      author.uid,
    )
    const result = unwrap(res)
    expect(result.data.createPoll.code).toBe('400')
    expect(result.data.createPoll.message).toBe('Poll minimum cannot be lower than campaign minimum (5)')
  })

  // 8. Sat inheritance — poll.max > campaign.max
  it('rejects poll.maxSatPerVote above campaign.maxSatPerVote', async () => {
    const author = await createTestUser()
    const campaign = await createTestCampaign(author.uid, { minSatPerVote: 1, maxSatPerVote: 50, suggestedSatPerVote: 10 })
    const res = await executeAsUser(
      server,
      CREATE_POLL,
      { pollInput: validInput(campaign.id, { minSatPerVote: 1, maxSatPerVote: 100, suggestedSatPerVote: 10 }) },
      author.uid,
    )
    const result = unwrap(res)
    expect(result.data.createPoll.code).toBe('400')
    expect(result.data.createPoll.message).toBe('Poll maximum cannot exceed campaign maximum (50)')
  })

  // 9. Privacy inheritance — campaign.blindVote=true, poll.blindVote=false
  it('rejects relaxing blindVote when the campaign requires it', async () => {
    const author = await createTestUser()
    const campaign = await createTestCampaign(author.uid, { blindVote: true })
    const res = await executeAsUser(
      server,
      CREATE_POLL,
      { pollInput: validInput(campaign.id, { blindVote: false }) },
      author.uid,
    )
    const result = unwrap(res)
    expect(result.data.createPoll.code).toBe('400')
    expect(result.data.createPoll.message).toBe('Campaign requires blindVote; poll cannot disable it')
  })

  // 10. Privacy inheritance — campaign.allowMultipleVotes=false, poll.allowMultipleVotes=true
  it('rejects enabling allowMultipleVotes when the campaign disables it', async () => {
    const author = await createTestUser()
    const campaign = await createTestCampaign(author.uid, { allowMultipleVotes: false })
    const res = await executeAsUser(
      server,
      CREATE_POLL,
      { pollInput: validInput(campaign.id, { allowMultipleVotes: true }) },
      author.uid,
    )
    const result = unwrap(res)
    expect(result.data.createPoll.code).toBe('400')
    expect(result.data.createPoll.message).toBe('Campaign disables multiple votes; poll cannot enable them')
  })

  // 11. Same title, exact casing, same campaign → composite unique
  it('rejects duplicate poll title (exact casing) in the same campaign with 409', async () => {
    const author = await createTestUser()
    const campaign = await createTestCampaign(author.uid)
    const r1 = await executeAsUser(
      server,
      CREATE_POLL,
      { pollInput: validInput(campaign.id, { title: 'Pizza' }) },
      author.uid,
    )
    expect(unwrap(r1).data.createPoll.success).toBe(true)

    const r2 = await executeAsUser(
      server,
      CREATE_POLL,
      { pollInput: validInput(campaign.id, { title: 'Pizza' }) },
      author.uid,
    )
    const result = unwrap(r2)
    expect(result.data.createPoll.code).toBe('409')
    expect(result.data.createPoll.message).toBe('A poll with this title already exists in this campaign')
  })

  // 12. Same title, different casing, same campaign → caught by titleLower index
  it('rejects duplicate poll title (different casing) in the same campaign with 409', async () => {
    const author = await createTestUser()
    const campaign = await createTestCampaign(author.uid)
    const r1 = await executeAsUser(
      server,
      CREATE_POLL,
      { pollInput: validInput(campaign.id, { title: 'Pizza' }) },
      author.uid,
    )
    expect(unwrap(r1).data.createPoll.success).toBe(true)

    const r2 = await executeAsUser(
      server,
      CREATE_POLL,
      { pollInput: validInput(campaign.id, { title: 'PIZZA' }) },
      author.uid,
    )
    const result = unwrap(r2)
    expect(result.data.createPoll.code).toBe('409')
    expect(result.data.createPoll.message).toBe('A poll with this title already exists in this campaign')
  })

  // 13. Same title in a DIFFERENT campaign — allowed (uniqueness is per-campaign)
  it('accepts the same poll title in a different campaign', async () => {
    const author = await createTestUser()
    const campaign1 = await createTestCampaign(author.uid)
    const campaign2 = await createTestCampaign(author.uid)
    const r1 = await executeAsUser(
      server,
      CREATE_POLL,
      { pollInput: validInput(campaign1.id, { title: 'Pizza' }) },
      author.uid,
    )
    expect(unwrap(r1).data.createPoll.success).toBe(true)

    const r2 = await executeAsUser(
      server,
      CREATE_POLL,
      { pollInput: validInput(campaign2.id, { title: 'Pizza' }) },
      author.uid,
    )
    expect(unwrap(r2).data.createPoll.code).toBe('200')
    expect(unwrap(r2).data.createPoll.success).toBe(true)
  })

  // 14. pollInput null
  it('rejects null pollInput with BAD_USER_INPUT GraphQL error', async () => {
    const author = await createTestUser()
    const res = await executeAsUser(server, CREATE_POLL, { pollInput: null }, author.uid)
    const result = unwrap(res)
    expect(result.errors).toBeDefined()
    expect(result.errors[0].extensions.code).toBe('BAD_USER_INPUT')
  })
})
