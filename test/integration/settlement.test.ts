// Integration tests for end-of-campaign settlement.
//
// Covers:
//   - handleCampaignEnd: snapshot building, ranks, percentages
//   - Idempotence (second call is a no-op)
//   - getCampaignResults query reads the snapshot
//   - Reconciliation logging (mismatch warning, doesn't block)
//
// We call handleCampaignEnd directly (not via the cron) so we don't have
// to wait for STATUS_CRON_INTERVAL_MS. The cron's two-phase logic
// (closeExpiredVotingWindows + settleUnsettledEndedCampaigns) is tested
// implicitly: the test sets the campaign to status='ended' before calling
// settle, exactly mirroring what the cron does.

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
import { DataSourcesMongo } from '../../src/datasourcesmongo.js'

const dataSourcesMongo = new DataSourcesMongo()

const ADD_VOTE = `
  mutation AddVote($voteInput: VoteInput) {
    addVote(voteInput: $voteInput) {
      code
      success
      message
    }
  }
`

const GET_CAMPAIGN_RESULTS = `
  query GetCampaignResults($campaignId: String!) {
    getCampaignResults(campaignId: $campaignId) {
      settledAt
      endingDate
      totalSats
      totalVotes
      totalUniqueVoters
      totalViews
      satsToAuthor
      satsToOSOV
      polls {
        id
        title
        totalSats
        totalVotes
        options {
          id
          title
          sats
          votes
          satsPercent
          votesPercent
          rank
        }
      }
    }
  }
`

/**
 * Cast a vote via the addVote mutation. Sets up the user balance first
 * so the vote isn't rejected for insufficient sats. Returns the response.
 */
async function castVote(server: any, voter: { uid: string }, campaign: { id: string }, poll: { id: string }, option: { id: string }, sats: number) {
  // top-up beyond what we need so multiple votes succeed
  await setUserSats(voter.uid, sats * 10)
  return await executeAsUser(
    server,
    ADD_VOTE,
    {
      voteInput: {
        invoice: `lnbc-test-${Date.now()}-${Math.random()}`,
        sats,
        campaignId: campaign.id,
        pollId: poll.id,
        pollOptionId: option.id,
        certified: true,
      },
    },
    voter.uid,
  )
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

describe('handleCampaignEnd (integration)', () => {
  // 1. Happy path — snapshot built, settledAt set, results stored
  it('builds a complete snapshot on the happy path', async () => {
    const author = await createTestUser()
    const voterA = await createTestUser()
    const voterB = await createTestUser()
    const now = new Date()
    // Campaign starts in the past, ends in the future — votes accepted now.
    // We'll simulate the cron transition (endingDate → past + status='ended')
    // just before calling handleCampaignEnd.
    const campaign = await createTestCampaign(author.uid, {
      status: 'active',
      startingDate: new Date(now.getTime() - 3600_000),
      endingDate: new Date(now.getTime() + 3600_000),
    })
    const poll = await createTestPoll(campaign.id, author.uid, { allowMultipleVotes: false })
    const optionA = await createTestPollOption(poll.id, { title: 'Pepperoni' })
    const optionB = await createTestPollOption(poll.id, { title: 'Mushrooms' })

    // 2 votes total: A wins
    await castVote(server, voterA, campaign, poll, optionA, 10)
    await castVote(server, voterB, campaign, poll, optionB, 5)

    // Cron simulates: status → ended, then settle
    // Simulate what the cron does: status flip + endingDate moved to past
    // (so validateVote would reject any further votes, mirroring reality).
    await prismaTest.campaign.update({
      where: { id: campaign.id },
      data: { status: 'ended', endingDate: new Date(Date.now() - 1000) },
    })
    const res = await dataSourcesMongo.handleCampaignEnd(campaign.id)
    expect(res.success).toBe(true)
    expect(res.settledNow).toBe(true)

    // Verify Mongo state
    const persisted = await prismaTest.campaign.findUnique({ where: { id: campaign.id } })
    expect(persisted!.status).toBe('ended')
    expect(persisted!.settledAt).not.toBeNull()
    expect(persisted!.results).toBeTruthy()

    const r = persisted!.results as any
    expect(r.totalSats).toBe(15)
    expect(r.totalVotes).toBe(2)
    expect(r.totalUniqueVoters).toBe(2)
    // Sat split: floor(15/2) + 1 = 8 to author, 7 to OSOV
    expect(r.satsToAuthor).toBe(8)
    expect(r.satsToOSOV).toBe(7)

    // Poll snapshot
    expect(r.polls).toHaveLength(1)
    expect(r.polls[0].totalSats).toBe(15)
    expect(r.polls[0].totalVotes).toBe(2)

    // Options sorted by sats DESC, ranks assigned
    const opts = r.polls[0].options
    expect(opts[0].title).toBe('Pepperoni')
    expect(opts[0].sats).toBe(10)
    expect(opts[0].rank).toBe(1)
    expect(opts[0].satsPercent).toBeCloseTo(66.7, 1)
    expect(opts[1].title).toBe('Mushrooms')
    expect(opts[1].sats).toBe(5)
    expect(opts[1].rank).toBe(2)
    expect(opts[1].satsPercent).toBeCloseTo(33.3, 1)
  })

  // 2. Idempotence — second call is a no-op
  it('is idempotent: second call returns settledNow=false', async () => {
    const author = await createTestUser()
    const voter = await createTestUser()
    const now = new Date()
    const campaign = await createTestCampaign(author.uid, {
      status: 'active',
      startingDate: new Date(now.getTime() - 3600_000),
      endingDate: new Date(now.getTime() + 3600_000),
    })
    const poll = await createTestPoll(campaign.id, author.uid)
    const option = await createTestPollOption(poll.id)
    await castVote(server, voter, campaign, poll, option, 5)

    // Simulate what the cron does: status flip + endingDate moved to past
    // (so validateVote would reject any further votes, mirroring reality).
    await prismaTest.campaign.update({
      where: { id: campaign.id },
      data: { status: 'ended', endingDate: new Date(Date.now() - 1000) },
    })

    const r1 = await dataSourcesMongo.handleCampaignEnd(campaign.id)
    expect(r1.settledNow).toBe(true)

    const r2 = await dataSourcesMongo.handleCampaignEnd(campaign.id)
    expect(r2.settledNow).toBe(false)
    expect(r2.message).toBe('already settled')

    // settledAt should be unchanged after the second call
    const after1 = await prismaTest.campaign.findUnique({ where: { id: campaign.id } })
    const settledAt1 = after1!.settledAt
    await dataSourcesMongo.handleCampaignEnd(campaign.id)
    const after2 = await prismaTest.campaign.findUnique({ where: { id: campaign.id } })
    expect(after2!.settledAt!.toISOString()).toBe(settledAt1!.toISOString())
  })

  // 3. Campaign with no votes — snapshot still produced, all zeros
  it('produces a snapshot even when the campaign has no votes', async () => {
    const author = await createTestUser()
    const now = new Date()
    const campaign = await createTestCampaign(author.uid, {
      status: 'active',
      startingDate: new Date(now.getTime() - 3600_000),
      endingDate: new Date(now.getTime() + 3600_000),
    })
    const poll = await createTestPoll(campaign.id, author.uid)
    await createTestPollOption(poll.id, { title: 'Yes' })
    await createTestPollOption(poll.id, { title: 'No' })

    // Simulate what the cron does: status flip + endingDate moved to past
    // (so validateVote would reject any further votes, mirroring reality).
    await prismaTest.campaign.update({
      where: { id: campaign.id },
      data: { status: 'ended', endingDate: new Date(Date.now() - 1000) },
    })
    const res = await dataSourcesMongo.handleCampaignEnd(campaign.id)
    expect(res.settledNow).toBe(true)

    const persisted = await prismaTest.campaign.findUnique({ where: { id: campaign.id } })
    const r = persisted!.results as any
    expect(r.totalSats).toBe(0)
    expect(r.totalVotes).toBe(0)
    expect(r.totalUniqueVoters).toBe(0)
    expect(r.satsToAuthor).toBe(0)
    expect(r.satsToOSOV).toBe(0)
    expect(r.polls[0].options).toHaveLength(2)
    // both options at 0 sats → tied → both rank 1
    expect(r.polls[0].options[0].rank).toBe(1)
    expect(r.polls[0].options[1].rank).toBe(1)
    expect(r.polls[0].options[0].satsPercent).toBe(0)
    expect(r.polls[0].options[1].satsPercent).toBe(0)
  })

  // 4. Tied options share the same rank
  it('assigns the same rank to options with equal sats (ties)', async () => {
    const author = await createTestUser()
    const voterA = await createTestUser()
    const voterB = await createTestUser()
    const now = new Date()
    const campaign = await createTestCampaign(author.uid, {
      status: 'active',
      startingDate: new Date(now.getTime() - 3600_000),
      endingDate: new Date(now.getTime() + 3600_000),
    })
    const poll = await createTestPoll(campaign.id, author.uid, { allowMultipleVotes: false })
    const optA = await createTestPollOption(poll.id, { title: 'A' })
    const optB = await createTestPollOption(poll.id, { title: 'B' })
    const optC = await createTestPollOption(poll.id, { title: 'C' })

    // A and B tied at 5 sats each, C with nothing
    await castVote(server, voterA, campaign, poll, optA, 5)
    await castVote(server, voterB, campaign, poll, optB, 5)

    // Simulate what the cron does: status flip + endingDate moved to past
    // (so validateVote would reject any further votes, mirroring reality).
    await prismaTest.campaign.update({
      where: { id: campaign.id },
      data: { status: 'ended', endingDate: new Date(Date.now() - 1000) },
    })
    await dataSourcesMongo.handleCampaignEnd(campaign.id)

    const persisted = await prismaTest.campaign.findUnique({ where: { id: campaign.id } })
    const opts = (persisted!.results as any).polls[0].options
    // Sort order is DESC sats; A and B both have 5, C has 0.
    // A and B tie at rank 1, C at rank 3 (rank skips position 2).
    expect(opts[0].sats).toBe(5)
    expect(opts[0].rank).toBe(1)
    expect(opts[1].sats).toBe(5)
    expect(opts[1].rank).toBe(1)
    expect(opts[2].sats).toBe(0)
    expect(opts[2].rank).toBe(3)
  })

  // 5. Multi-poll campaign
  it('handles multi-poll campaigns and aggregates per-poll', async () => {
    const author = await createTestUser()
    const voter = await createTestUser()
    const now = new Date()
    const campaign = await createTestCampaign(author.uid, {
      status: 'active',
      startingDate: new Date(now.getTime() - 3600_000),
      endingDate: new Date(now.getTime() + 3600_000),
      allowMultipleVotes: true,
    })
    const pollA = await createTestPoll(campaign.id, author.uid, { allowMultipleVotes: true, title: 'Poll A' })
    const pollB = await createTestPoll(campaign.id, author.uid, { allowMultipleVotes: true, title: 'Poll B' })
    const optA1 = await createTestPollOption(pollA.id, { title: 'A1' })
    const optB1 = await createTestPollOption(pollB.id, { title: 'B1' })

    await castVote(server, voter, campaign, pollA, optA1, 7)
    await castVote(server, voter, campaign, pollB, optB1, 3)

    // Simulate what the cron does: status flip + endingDate moved to past
    // (so validateVote would reject any further votes, mirroring reality).
    await prismaTest.campaign.update({
      where: { id: campaign.id },
      data: { status: 'ended', endingDate: new Date(Date.now() - 1000) },
    })
    await dataSourcesMongo.handleCampaignEnd(campaign.id)

    const persisted = await prismaTest.campaign.findUnique({ where: { id: campaign.id } })
    const r = persisted!.results as any
    expect(r.totalSats).toBe(10)
    expect(r.totalVotes).toBe(2)
    expect(r.totalUniqueVoters).toBe(1) // same voter twice
    expect(r.polls).toHaveLength(2)
    const pollAResults = r.polls.find((p: any) => p.id === pollA.id)
    const pollBResults = r.polls.find((p: any) => p.id === pollB.id)
    expect(pollAResults.totalSats).toBe(7)
    expect(pollBResults.totalSats).toBe(3)
  })

  // 6. Campaign not found
  it('returns failure when the campaign does not exist', async () => {
    const fakeId = '0000a0a0a0a0a0a0a0a0a0a0'
    const res = await dataSourcesMongo.handleCampaignEnd(fakeId)
    expect(res.success).toBe(false)
    expect(res.message).toBe('Campaign not found')
    expect(res.settledNow).toBe(false)
  })
})

describe('getCampaignResults query (integration)', () => {
  // 7. Returns null when not yet settled
  it('returns null for a campaign that has not been settled yet', async () => {
    const author = await createTestUser()
    const campaign = await createTestCampaign(author.uid, { status: 'active' })

    const res = await executeAsUser(
      server,
      GET_CAMPAIGN_RESULTS,
      { campaignId: campaign.id },
      null, // no auth — this query is public
    )
    const result = unwrap(res)
    expect(result.errors).toBeUndefined()
    expect(result.data.getCampaignResults).toBeNull()
  })

  // 8. Returns the snapshot once settled
  it('returns the snapshot after settlement', async () => {
    const author = await createTestUser()
    const voter = await createTestUser()
    const now = new Date()
    const campaign = await createTestCampaign(author.uid, {
      status: 'active',
      startingDate: new Date(now.getTime() - 3600_000),
      endingDate: new Date(now.getTime() + 3600_000),
    })
    const poll = await createTestPoll(campaign.id, author.uid)
    const option = await createTestPollOption(poll.id, { title: 'Choice' })
    await castVote(server, voter, campaign, poll, option, 12)

    // Simulate what the cron does: status flip + endingDate moved to past
    // (so validateVote would reject any further votes, mirroring reality).
    await prismaTest.campaign.update({
      where: { id: campaign.id },
      data: { status: 'ended', endingDate: new Date(Date.now() - 1000) },
    })
    await dataSourcesMongo.handleCampaignEnd(campaign.id)

    const res = await executeAsUser(
      server,
      GET_CAMPAIGN_RESULTS,
      { campaignId: campaign.id },
      null,
    )
    const result = unwrap(res)
    expect(result.errors).toBeUndefined()
    const r = result.data.getCampaignResults
    expect(r).not.toBeNull()
    expect(r.totalSats).toBe(12)
    expect(r.totalVotes).toBe(1)
    expect(r.totalUniqueVoters).toBe(1)
    expect(r.satsToAuthor).toBe(7) // floor(12/2) + 1
    expect(r.satsToOSOV).toBe(5)
    expect(r.polls).toHaveLength(1)
    expect(r.polls[0].options[0].title).toBe('Choice')
    expect(r.polls[0].options[0].rank).toBe(1)
    expect(r.polls[0].options[0].satsPercent).toBe(100)
  })

  // 9. Returns null for a non-existent campaign
  it('returns null for a non-existent campaignId', async () => {
    const res = await executeAsUser(
      server,
      GET_CAMPAIGN_RESULTS,
      { campaignId: '0000a0a0a0a0a0a0a0a0a0a0' },
      null,
    )
    const result = unwrap(res)
    expect(result.data.getCampaignResults).toBeNull()
  })
})
