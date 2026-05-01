// Integration tests for the accountFunding mutation.
// Phase 1 (dev) — recharge instantanée sans Lightning Network.
//
// Auth is faked by injecting `userId` directly into contextValue (see setup.ts).

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import {
  getTestServer,
  prismaTest,
  cleanupDatabase,
  cleanupRedis,
  createTestUser,
  executeAsUser,
  unwrap,
  disconnectRedis,
} from './setup.js'

const ACCOUNT_FUNDING = `
  mutation AccountFunding($fundingInput: FundingInput) {
    accountFunding(fundingInput: $fundingInput) {
      code
      success
      message
      funding {
        userId
        invoice
        sats
        date
      }
    }
  }
`

const validInput = (overrides: Partial<Record<string, any>> = {}) => ({
  invoice: `lnbc-test-${Date.now()}-${Math.random()}`,
  sats: 1000,
  ...overrides,
})

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

describe('accountFunding mutation (integration)', () => {
  // 1. Auth missing
  it('rejects with UNAUTHENTICATED when no userId is in context', async () => {
    const res = await executeAsUser(server, ACCOUNT_FUNDING, { fundingInput: validInput() }, null)
    const result = unwrap(res)
    expect(result.errors).toBeDefined()
    expect(result.errors[0].extensions.code).toBe('UNAUTHENTICATED')
  })

  // 2. Happy path
  it('creates a Funding row and increments the Redis balance', async () => {
    const user = await createTestUser()
    const input = validInput({ sats: 500 })

    const res = await executeAsUser(server, ACCOUNT_FUNDING, { fundingInput: input }, user.uid)
    const result = unwrap(res)
    expect(result.errors).toBeUndefined()
    expect(result.data.accountFunding.code).toBe('200')
    expect(result.data.accountFunding.success).toBe(true)
    expect(result.data.accountFunding.funding.userId).toBe(user.uid)
    expect(result.data.accountFunding.funding.sats).toBe(500)
    expect(result.data.accountFunding.funding.invoice).toBe(input.invoice)

    const persisted = await prismaTest.funding.findUnique({
      where: { invoice: input.invoice },
    })
    expect(persisted).toBeTruthy()
    expect(persisted!.sats).toBe(500)
  })

  // 3. fundingInput null
  it('rejects null fundingInput with BAD_USER_INPUT GraphQL error', async () => {
    const user = await createTestUser()
    const res = await executeAsUser(server, ACCOUNT_FUNDING, { fundingInput: null }, user.uid)
    const result = unwrap(res)
    expect(result.errors).toBeDefined()
    expect(result.errors[0].extensions.code).toBe('BAD_USER_INPUT')
  })

  // 4. Negative sats
  it('rejects negative sats with 400', async () => {
    const user = await createTestUser()
    const res = await executeAsUser(
      server,
      ACCOUNT_FUNDING,
      { fundingInput: validInput({ sats: -10 }) },
      user.uid,
    )
    const result = unwrap(res)
    expect(result.data.accountFunding.code).toBe('400')
    expect(result.data.accountFunding.message).toBe('sats must be a positive integer')
  })

  // 5. Zero sats
  it('rejects zero sats with 400', async () => {
    const user = await createTestUser()
    const res = await executeAsUser(
      server,
      ACCOUNT_FUNDING,
      { fundingInput: validInput({ sats: 0 }) },
      user.uid,
    )
    const result = unwrap(res)
    expect(result.data.accountFunding.code).toBe('400')
  })

  // 6. Empty invoice
  it('rejects whitespace-only invoice with 400', async () => {
    const user = await createTestUser()
    const res = await executeAsUser(
      server,
      ACCOUNT_FUNDING,
      { fundingInput: validInput({ invoice: '   ' }) },
      user.uid,
    )
    const result = unwrap(res)
    expect(result.data.accountFunding.code).toBe('400')
    expect(result.data.accountFunding.message).toBe('invoice is required')
  })

  // 7. Duplicate invoice — composite unique catch
  it('rejects a re-used invoice with 409', async () => {
    const user = await createTestUser()
    const input = validInput({ invoice: 'lnbc-shared' })

    const r1 = await executeAsUser(server, ACCOUNT_FUNDING, { fundingInput: input }, user.uid)
    expect(unwrap(r1).data.accountFunding.success).toBe(true)

    const r2 = await executeAsUser(server, ACCOUNT_FUNDING, { fundingInput: input }, user.uid)
    const result = unwrap(r2)
    expect(result.data.accountFunding.code).toBe('409')
    expect(result.data.accountFunding.message).toBe('This invoice has already been used')
  })

  // 8. Same invoice across two different users — also blocked (invoice is globally unique)
  it('rejects the same invoice across different users with 409', async () => {
    const userA = await createTestUser()
    const userB = await createTestUser()
    const input = validInput({ invoice: 'lnbc-cross-user' })

    const r1 = await executeAsUser(server, ACCOUNT_FUNDING, { fundingInput: input }, userA.uid)
    expect(unwrap(r1).data.accountFunding.success).toBe(true)

    const r2 = await executeAsUser(server, ACCOUNT_FUNDING, { fundingInput: input }, userB.uid)
    expect(unwrap(r2).data.accountFunding.code).toBe('409')
  })
})
