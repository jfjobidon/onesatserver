// Integration tests for the addVote mutation (Phase A — sécurité de base).
//
// See documentation/addvote-audit.md and documentation/acid-lua-redis.md
// for the design rationale. Phase A keeps the cascade non-atomic on purpose;
// Phase B will tighten that with a Lua script.
//
// Auth is faked by injecting `userId` directly into contextValue (see setup.ts).

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import {
  getTestServer,
  prismaTest,
  cleanupDatabase,
  cleanupRedis,
  createTestUser,
  createTestCampaign,
  createTestPoll,
  createTestPollOption,
  setUserSats,
  executeAsUser,
  unwrap,
  disconnectRedis,
} from './setup.js'

const ADD_VOTE = `
  mutation AddVote($voteInput: VoteInput) {
    addVote(voteInput: $voteInput) {
      code
      success
      message
      vote {
        uid
        userName
        sats
        campaignId
        pollId
        pollOptionId
        certified
      }
    }
  }
`

const validInput = (
  campaignId: string,
  pollId: string,
  pollOptionId: string,
  overrides: Partial<Record<string, any>> = {},
) => ({
  invoice: `lnbc-test-${Date.now()}-${Math.random()}`,
  sats: 5,
  campaignId,
  pollId,
  pollOptionId,
  certified: true,
  ...overrides,
})

/**
 * Build a fully-wired voting scenario:
 *   - 1 author, 1 voter
 *   - campaign in `published` status (so votes are accepted)
 *   - poll under it (allowMultipleVotes false by default)
 *   - 1 option under the poll
 *   - voter has 10 000 sats credited in Redis
 *
 * Dates are pushed back so `now ∈ [startingDate, endingDate]` — the
 * default helper uses startingDate = now+1d which would fail the date check.
 */
async function setupVotingScenario(overrides: {
  campaignStatus?: string
  campaignPaused?: boolean
  pollPaused?: boolean
  allowMultipleVotes?: boolean
  voterBalance?: number
  campaignMin?: number
  campaignMax?: number
} = {}) {
  const author = await createTestUser()
  const voter = await createTestUser()
  const now = new Date()
  const campaign = await createTestCampaign(author.uid, {
    status: overrides.campaignStatus ?? 'active',
    paused: overrides.campaignPaused ?? false,
    minSatPerVote: overrides.campaignMin ?? 1,
    maxSatPerVote: overrides.campaignMax ?? 100,
    suggestedSatPerVote: 5,
    startingDate: new Date(now.getTime() - 60 * 60 * 1000),       // -1h
    endingDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), // +7d
  })
  const poll = await createTestPoll(campaign.id, author.uid, {
    paused: overrides.pollPaused ?? false,
    allowMultipleVotes: overrides.allowMultipleVotes ?? false,
  })
  const option = await createTestPollOption(poll.id)
  await setUserSats(voter.uid, overrides.voterBalance ?? 10_000)
  return { author, voter, campaign, poll, option }
}

let server: Awaited<ReturnType<typeof getTestServer>>

beforeAll(async () => {
  server = await getTestServer()
  await cleanupDatabase()
  await cleanupRedis()
})

beforeEach(async () => {
  await cleanupDatabase()
  await cleanupRedis()
})

afterAll(async () => {
  await prismaTest.$disconnect()
  await disconnectRedis()
})

describe('addVote mutation (integration, Phase A)', () => {
  // 1. Auth missing
  it('rejects with UNAUTHENTICATED when no userId is in context', async () => {
    const { campaign, poll, option } = await setupVotingScenario()
    const res = await executeAsUser(
      server,
      ADD_VOTE,
      { voteInput: validInput(campaign.id, poll.id, option.id) },
      null,
    )
    const result = unwrap(res)
    expect(result.errors).toBeDefined()
    expect(result.errors[0].extensions.code).toBe('UNAUTHENTICATED')
  })

  // 2. voteInput null
  it('rejects null voteInput with BAD_USER_INPUT GraphQL error', async () => {
    const voter = await createTestUser()
    const res = await executeAsUser(server, ADD_VOTE, { voteInput: null }, voter.uid)
    const result = unwrap(res)
    expect(result.errors).toBeDefined()
    expect(result.errors[0].extensions.code).toBe('BAD_USER_INPUT')
  })

  // 3. Happy path
  it('records a vote on the happy path with the correct uid and userName', async () => {
    const { voter, campaign, poll, option } = await setupVotingScenario()
    const res = await executeAsUser(
      server,
      ADD_VOTE,
      { voteInput: validInput(campaign.id, poll.id, option.id, { sats: 5 }) },
      voter.uid,
    )
    const result = unwrap(res)
    expect(result.errors).toBeUndefined()
    expect(result.data.addVote.code).toBe(200)
    expect(result.data.addVote.success).toBe(true)
    // Voter identity comes from context, NOT from the input.
    expect(result.data.addVote.vote.uid).toBe(voter.uid)
    expect(result.data.addVote.vote.userName).toBe(voter.userName)
    expect(result.data.addVote.vote.sats).toBe(5)
  })

  // 4. Insufficient balance
  it('rejects when the voter balance is below the requested sats', async () => {
    const { voter, campaign, poll, option } = await setupVotingScenario({ voterBalance: 2 })
    const res = await executeAsUser(
      server,
      ADD_VOTE,
      { voteInput: validInput(campaign.id, poll.id, option.id, { sats: 10 }) },
      voter.uid,
    )
    const result = unwrap(res)
    expect(result.data.addVote.code).toBe(400)
    expect(result.data.addVote.message).toMatch(/Insufficient sats/)
  })

  // 5. Zero balance (user never funded)
  it('rejects when the voter has no balance at all', async () => {
    const author = await createTestUser()
    const voter = await createTestUser()
    const now = new Date()
    const campaign = await createTestCampaign(author.uid, {
      status: 'active',
      startingDate: new Date(now.getTime() - 3600_000),
      endingDate: new Date(now.getTime() + 7 * 86400_000),
    })
    const poll = await createTestPoll(campaign.id, author.uid)
    const option = await createTestPollOption(poll.id)
    // Note: setUserSats is intentionally NOT called here.

    const res = await executeAsUser(
      server,
      ADD_VOTE,
      { voteInput: validInput(campaign.id, poll.id, option.id, { sats: 1 }) },
      voter.uid,
    )
    const result = unwrap(res)
    expect(result.data.addVote.code).toBe(400)
    expect(result.data.addVote.message).toMatch(/Insufficient sats/)
  })

  // 6. Campaign in draft → rejected
  it('rejects votes on a draft campaign with 409', async () => {
    const { voter, campaign, poll, option } = await setupVotingScenario({ campaignStatus: 'draft' })
    const res = await executeAsUser(
      server,
      ADD_VOTE,
      { voteInput: validInput(campaign.id, poll.id, option.id) },
      voter.uid,
    )
    const result = unwrap(res)
    expect(result.data.addVote.code).toBe(409)
    expect(result.data.addVote.message).toMatch(/Cannot vote on a draft campaign/)
  })

  // 6b. Campaign published (scheduled, not yet active) → rejected
  it('rejects votes on a published (not yet active) campaign with 409', async () => {
    const { voter, campaign, poll, option } = await setupVotingScenario({ campaignStatus: 'published' })
    const res = await executeAsUser(
      server,
      ADD_VOTE,
      { voteInput: validInput(campaign.id, poll.id, option.id) },
      voter.uid,
    )
    const result = unwrap(res)
    expect(result.data.addVote.code).toBe(409)
    expect(result.data.addVote.message).toMatch(/Cannot vote on a published campaign/)
  })

  // 7. Campaign ended → rejected
  it('rejects votes on an ended campaign with 409', async () => {
    const { voter, campaign, poll, option } = await setupVotingScenario({ campaignStatus: 'ended' })
    const res = await executeAsUser(
      server,
      ADD_VOTE,
      { voteInput: validInput(campaign.id, poll.id, option.id) },
      voter.uid,
    )
    const result = unwrap(res)
    expect(result.data.addVote.code).toBe(409)
    expect(result.data.addVote.message).toMatch(/Cannot vote on an ended campaign/)
  })

  // 8. Campaign paused → rejected
  it('rejects votes on a paused campaign with 409', async () => {
    const { voter, campaign, poll, option } = await setupVotingScenario({ campaignPaused: true })
    const res = await executeAsUser(
      server,
      ADD_VOTE,
      { voteInput: validInput(campaign.id, poll.id, option.id) },
      voter.uid,
    )
    const result = unwrap(res)
    expect(result.data.addVote.code).toBe(409)
    expect(result.data.addVote.message).toBe('Campaign is paused')
  })

  // 9. Poll paused → rejected
  it('rejects votes on a paused poll with 409', async () => {
    const { voter, campaign, poll, option } = await setupVotingScenario({ pollPaused: true })
    const res = await executeAsUser(
      server,
      ADD_VOTE,
      { voteInput: validInput(campaign.id, poll.id, option.id) },
      voter.uid,
    )
    const result = unwrap(res)
    expect(result.data.addVote.code).toBe(409)
    expect(result.data.addVote.message).toBe('Poll is paused')
  })

  // 10. Sats below campaign min
  it('rejects votes below the campaign minimum with 400', async () => {
    const { voter, campaign, poll, option } = await setupVotingScenario({ campaignMin: 10 })
    const res = await executeAsUser(
      server,
      ADD_VOTE,
      { voteInput: validInput(campaign.id, poll.id, option.id, { sats: 5 }) },
      voter.uid,
    )
    const result = unwrap(res)
    expect(result.data.addVote.code).toBe(400)
    expect(result.data.addVote.message).toMatch(/at least 10 sats/)
  })

  // 11. Sats above campaign max
  it('rejects votes above the campaign maximum with 400', async () => {
    const { voter, campaign, poll, option } = await setupVotingScenario({ campaignMax: 50 })
    const res = await executeAsUser(
      server,
      ADD_VOTE,
      { voteInput: validInput(campaign.id, poll.id, option.id, { sats: 100 }) },
      voter.uid,
    )
    const result = unwrap(res)
    expect(result.data.addVote.code).toBe(400)
    expect(result.data.addVote.message).toMatch(/at most 50 sats/)
  })

  // 12. PollOption belongs to a different poll
  it('rejects when pollOption.pollId does not match voteInput.pollId', async () => {
    const { voter, author, campaign, poll, option } = await setupVotingScenario()
    // Create a second poll under the same campaign and use the option from poll 1
    // but pass poll 2's id — should fail the consistency check.
    const otherPoll = await createTestPoll(campaign.id, author.uid)
    const res = await executeAsUser(
      server,
      ADD_VOTE,
      {
        voteInput: validInput(campaign.id, otherPoll.id, option.id),
      },
      voter.uid,
    )
    const result = unwrap(res)
    expect(result.data.addVote.code).toBe(400)
    expect(result.data.addVote.message).toMatch(/does not belong to the given poll/)
  })

  // 13. Double-vote when allowMultipleVotes=false
  it('rejects a second vote on the same poll when allowMultipleVotes=false', async () => {
    const { voter, campaign, poll, option } = await setupVotingScenario({ allowMultipleVotes: false })

    const r1 = await executeAsUser(
      server,
      ADD_VOTE,
      { voteInput: validInput(campaign.id, poll.id, option.id, { sats: 1 }) },
      voter.uid,
    )
    expect(unwrap(r1).data.addVote.success).toBe(true)

    const r2 = await executeAsUser(
      server,
      ADD_VOTE,
      { voteInput: validInput(campaign.id, poll.id, option.id, { sats: 1 }) },
      voter.uid,
    )
    const result = unwrap(r2)
    expect(result.data.addVote.code).toBe(409)
    expect(result.data.addVote.message).toBe('You have already voted on this poll')
  })

  // 14. allowMultipleVotes=true → second vote is allowed
  it('accepts a second vote on the same poll when allowMultipleVotes=true', async () => {
    const { voter, campaign, poll, option } = await setupVotingScenario({ allowMultipleVotes: true })

    const r1 = await executeAsUser(
      server,
      ADD_VOTE,
      { voteInput: validInput(campaign.id, poll.id, option.id, { sats: 1 }) },
      voter.uid,
    )
    expect(unwrap(r1).data.addVote.success).toBe(true)

    const r2 = await executeAsUser(
      server,
      ADD_VOTE,
      { voteInput: validInput(campaign.id, poll.id, option.id, { sats: 1 }) },
      voter.uid,
    )
    expect(unwrap(r2).data.addVote.code).toBe(200)
    expect(unwrap(r2).data.addVote.success).toBe(true)
  })
})
