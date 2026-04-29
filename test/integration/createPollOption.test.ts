// Integration tests for the createPollOption mutation.
// Mirrors the test cases listed in onesatclient/docs/specs-for-server.md
// section "createPollOption — author-only + status check + title uniqueness".
//
// Auth is faked by injecting `userId` directly into contextValue (see setup.ts).

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import {
  getTestServer,
  prismaTest,
  cleanupDatabase,
  createTestUser,
  createTestCampaign,
  createTestPoll,
  executeAsUser,
  unwrap,
} from './setup.js'

const CREATE_POLL_OPTION = `
  mutation CreatePollOption($pollOptionInput: PollOptionInput) {
    createPollOption(pollOptionInput: $pollOptionInput) {
      code
      success
      message
      pollOption {
        id
        pollId
        title
        description
        sats
        votes
        views
      }
    }
  }
`

const validInput = (pollId: string, overrides: Partial<Record<string, any>> = {}) => ({
  pollId,
  title: `Option ${Date.now()}-${Math.random()}`,
  description: 'Created by createPollOption integration test',
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

describe('createPollOption mutation (integration)', () => {
  // 1. Auth missing
  it('rejects with UNAUTHENTICATED when no userId is in context', async () => {
    const author = await createTestUser()
    const campaign = await createTestCampaign(author.uid)
    const poll = await createTestPoll(campaign.id, author.uid)
    const res = await executeAsUser(
      server,
      CREATE_POLL_OPTION,
      { pollOptionInput: validInput(poll.id) },
      null,
    )
    const result = unwrap(res)
    expect(result.errors).toBeDefined()
    expect(result.errors[0].extensions.code).toBe('UNAUTHENTICATED')
  })

  // 2. Happy path — DB persistence verified
  it('creates a poll option on the happy path and persists titleLower lowercased', async () => {
    const author = await createTestUser()
    const campaign = await createTestCampaign(author.uid)
    const poll = await createTestPoll(campaign.id, author.uid)
    const input = validInput(poll.id, { title: 'Pepperoni' })

    const res = await executeAsUser(
      server,
      CREATE_POLL_OPTION,
      { pollOptionInput: input },
      author.uid,
    )
    const result = unwrap(res)
    expect(result.errors).toBeUndefined()
    expect(result.data.createPollOption.code).toBe('200')
    expect(result.data.createPollOption.success).toBe(true)
    expect(result.data.createPollOption.pollOption.title).toBe('Pepperoni') // casing preserved
    expect(result.data.createPollOption.pollOption.pollId).toBe(poll.id)

    const persisted = await prismaTest.pollOption.findUnique({
      where: { id: result.data.createPollOption.pollOption.id },
    })
    expect(persisted).toBeTruthy()
    expect(persisted!.title).toBe('Pepperoni')
    expect(persisted!.titleLower).toBe('pepperoni')
    expect(persisted!.pollId).toBe(poll.id)
  })

  // 3. Poll not found
  it('returns 404 "Poll not found" when pollId does not exist', async () => {
    const author = await createTestUser()
    const fakeId = '0000a0a0a0a0a0a0a0a0a0a0' // valid 24-char ObjectId, not in DB
    const res = await executeAsUser(
      server,
      CREATE_POLL_OPTION,
      { pollOptionInput: validInput(fakeId) },
      author.uid,
    )
    const result = unwrap(res)
    expect(result.data.createPollOption.code).toBe('404')
    expect(result.data.createPollOption.message).toBe('Poll not found')
  })

  // 4. Different user (not the campaign author)
  it('returns 403 when the caller is not the campaign author', async () => {
    const author = await createTestUser()
    const otherUser = await createTestUser()
    const campaign = await createTestCampaign(author.uid)
    const poll = await createTestPoll(campaign.id, author.uid)
    const res = await executeAsUser(
      server,
      CREATE_POLL_OPTION,
      { pollOptionInput: validInput(poll.id) },
      otherUser.uid,
    )
    const result = unwrap(res)
    expect(result.data.createPollOption.code).toBe('403')
    expect(result.data.createPollOption.message).toBe('Only the campaign author can add a poll option')
  })

  // 5. Campaign already published — status check
  it('returns 409 when the campaign is published', async () => {
    const author = await createTestUser()
    const campaign = await createTestCampaign(author.uid, { status: 'published' })
    const poll = await createTestPoll(campaign.id, author.uid)
    const res = await executeAsUser(
      server,
      CREATE_POLL_OPTION,
      { pollOptionInput: validInput(poll.id) },
      author.uid,
    )
    const result = unwrap(res)
    expect(result.data.createPollOption.code).toBe('409')
    expect(result.data.createPollOption.message).toBe('Cannot add a poll option to a published campaign')
  })

  // 6. Campaign already ended — status check (article "an")
  it('returns 409 when the campaign is ended', async () => {
    const author = await createTestUser()
    const campaign = await createTestCampaign(author.uid, { status: 'ended' })
    const poll = await createTestPoll(campaign.id, author.uid)
    const res = await executeAsUser(
      server,
      CREATE_POLL_OPTION,
      { pollOptionInput: validInput(poll.id) },
      author.uid,
    )
    const result = unwrap(res)
    expect(result.data.createPollOption.code).toBe('409')
    expect(result.data.createPollOption.message).toBe('Cannot add a poll option to an ended campaign')
  })

  // 7. Empty title
  it('rejects an empty title with 400', async () => {
    const author = await createTestUser()
    const campaign = await createTestCampaign(author.uid)
    const poll = await createTestPoll(campaign.id, author.uid)
    const res = await executeAsUser(
      server,
      CREATE_POLL_OPTION,
      { pollOptionInput: validInput(poll.id, { title: '   ' }) },
      author.uid,
    )
    const result = unwrap(res)
    expect(result.data.createPollOption.code).toBe('400')
    expect(result.data.createPollOption.message).toBe('Title is required')
  })

  // 8. Empty description (description is now required)
  it('rejects an empty description with 400', async () => {
    const author = await createTestUser()
    const campaign = await createTestCampaign(author.uid)
    const poll = await createTestPoll(campaign.id, author.uid)
    const res = await executeAsUser(
      server,
      CREATE_POLL_OPTION,
      { pollOptionInput: validInput(poll.id, { description: '   ' }) },
      author.uid,
    )
    const result = unwrap(res)
    expect(result.data.createPollOption.code).toBe('400')
    expect(result.data.createPollOption.message).toBe('Description is required')
  })

  // 9. Same title, exact casing, same poll → composite unique catch
  it('rejects duplicate option title (exact casing) in the same poll with 409', async () => {
    const author = await createTestUser()
    const campaign = await createTestCampaign(author.uid)
    const poll = await createTestPoll(campaign.id, author.uid)
    const r1 = await executeAsUser(
      server,
      CREATE_POLL_OPTION,
      { pollOptionInput: validInput(poll.id, { title: 'Pepperoni' }) },
      author.uid,
    )
    expect(unwrap(r1).data.createPollOption.success).toBe(true)

    const r2 = await executeAsUser(
      server,
      CREATE_POLL_OPTION,
      { pollOptionInput: validInput(poll.id, { title: 'Pepperoni' }) },
      author.uid,
    )
    const result = unwrap(r2)
    expect(result.data.createPollOption.code).toBe('409')
    expect(result.data.createPollOption.message).toBe('An option with this title already exists in this poll')
  })

  // 10. Same title, different casing, same poll → caught by titleLower index
  it('rejects duplicate option title (different casing) in the same poll with 409', async () => {
    const author = await createTestUser()
    const campaign = await createTestCampaign(author.uid)
    const poll = await createTestPoll(campaign.id, author.uid)
    const r1 = await executeAsUser(
      server,
      CREATE_POLL_OPTION,
      { pollOptionInput: validInput(poll.id, { title: 'Pepperoni' }) },
      author.uid,
    )
    expect(unwrap(r1).data.createPollOption.success).toBe(true)

    const r2 = await executeAsUser(
      server,
      CREATE_POLL_OPTION,
      { pollOptionInput: validInput(poll.id, { title: 'PEPPERONI' }) },
      author.uid,
    )
    const result = unwrap(r2)
    expect(result.data.createPollOption.code).toBe('409')
    expect(result.data.createPollOption.message).toBe('An option with this title already exists in this poll')
  })

  // 11. Same title in a DIFFERENT poll — allowed (uniqueness is per-poll)
  it('accepts the same option title in a different poll', async () => {
    const author = await createTestUser()
    const campaign = await createTestCampaign(author.uid)
    const poll1 = await createTestPoll(campaign.id, author.uid)
    const poll2 = await createTestPoll(campaign.id, author.uid)
    const r1 = await executeAsUser(
      server,
      CREATE_POLL_OPTION,
      { pollOptionInput: validInput(poll1.id, { title: 'Pepperoni' }) },
      author.uid,
    )
    expect(unwrap(r1).data.createPollOption.success).toBe(true)

    const r2 = await executeAsUser(
      server,
      CREATE_POLL_OPTION,
      { pollOptionInput: validInput(poll2.id, { title: 'Pepperoni' }) },
      author.uid,
    )
    expect(unwrap(r2).data.createPollOption.code).toBe('200')
    expect(unwrap(r2).data.createPollOption.success).toBe(true)
  })

  // 12. pollOptionInput null
  it('rejects null pollOptionInput with BAD_USER_INPUT GraphQL error', async () => {
    const author = await createTestUser()
    const res = await executeAsUser(server, CREATE_POLL_OPTION, { pollOptionInput: null }, author.uid)
    const result = unwrap(res)
    expect(result.errors).toBeDefined()
    expect(result.errors[0].extensions.code).toBe('BAD_USER_INPUT')
  })
})
