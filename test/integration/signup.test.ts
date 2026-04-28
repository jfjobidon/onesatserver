// Integration tests for the signup mutation.
// Exercises the full chain: Apollo → resolver (mutations.ts) → datasource
// (datasourcesmongo.ts) → Prisma → MongoDB Docker (osov-mongo-test, port 27018).
//
// Unlike createCampaign, signup is UNAUTHENTICATED — the user does not yet
// exist when this mutation is called. Tests pass `null` as userId so the
// context is { isAuthenticated: false }.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import {
  getTestServer,
  prismaTest,
  cleanupDatabase,
  executeAsUser,
  unwrap,
} from './setup.js'

const SIGNUP = `
  mutation Signup($userInput: UserInput) {
    signup(userInput: $userInput) {
      code
      success
      message
      user {
        id
        email
        userName
        uid
      }
    }
  }
`

let counter = 0
const validInput = (overrides: Partial<Record<string, any>> = {}) => {
  counter += 1
  return {
    email: `test-${counter}-${Date.now()}@osov.test`,
    userName: `testuser_${counter}`,
    uid: `firebase-uid-${counter}-${Date.now()}`,
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
  await prismaTest.$disconnect()
})

describe('signup mutation (integration)', () => {
  // 1. Happy path
  it('creates a user on the happy path with userNameLower normalized', async () => {
    const input = validInput({ userName: 'JFjobidon', email: 'JFjobidon@osov.test' })
    const res = await executeAsUser(server, SIGNUP, { userInput: input }, null)
    const result = unwrap(res)

    expect(result.errors).toBeUndefined()
    expect(result.data.signup.code).toBe('200')
    expect(result.data.signup.success).toBe(true)
    expect(result.data.signup.user.userName).toBe('JFjobidon') // casing preserved
    // Email should be lowercased at storage
    expect(result.data.signup.user.email).toBe('jfjobidon@osov.test')

    // Round-trip: confirm userNameLower lives in DB even if not in GraphQL response
    const persisted = await prismaTest.user.findUnique({
      where: { uid: input.uid },
    })
    expect(persisted).toBeTruthy()
    expect(persisted!.userName).toBe('JFjobidon')
    expect(persisted!.userNameLower).toBe('jfjobidon')
    expect(persisted!.email).toBe('jfjobidon@osov.test')
  })

  // 2. Empty username
  it('rejects empty userName with 400', async () => {
    const res = await executeAsUser(
      server,
      SIGNUP,
      { userInput: validInput({ userName: '' }) },
      null,
    )
    // userName empty triggers the resolver's BAD_USER_INPUT guard before reaching the datasource
    const result = unwrap(res)
    expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT')
  })

  // 3. Whitespace-only username (passes resolver guard but caught by datasource validateUsername)
  it('rejects whitespace-only userName with 400', async () => {
    const res = await executeAsUser(
      server,
      SIGNUP,
      { userInput: validInput({ userName: '   ' }) },
      null,
    )
    const result = unwrap(res)
    expect(result.data.signup.code).toBe('400')
    expect(result.data.signup.message).toBe('Username is required')
  })

  // 4. Username too short
  it('rejects userName below MIN_USERNAME_LENGTH', async () => {
    const res = await executeAsUser(
      server,
      SIGNUP,
      { userInput: validInput({ userName: 'jf' }) },
      null,
    )
    const result = unwrap(res)
    expect(result.data.signup.code).toBe('400')
    expect(result.data.signup.message).toBe('Username must be at least 3 characters')
  })

  // 5. Invalid charset
  it('rejects userName with disallowed characters', async () => {
    const res = await executeAsUser(
      server,
      SIGNUP,
      { userInput: validInput({ userName: 'jf jobidon' }) },
      null,
    )
    const result = unwrap(res)
    expect(result.data.signup.code).toBe('400')
    expect(result.data.signup.message).toBe(
      'Username can only contain letters, numbers, underscore (_) and dash (-)',
    )
  })

  // 6. Reserved username
  it('rejects reserved userName "admin"', async () => {
    const res = await executeAsUser(
      server,
      SIGNUP,
      { userInput: validInput({ userName: 'admin' }) },
      null,
    )
    const result = unwrap(res)
    expect(result.data.signup.code).toBe('400')
    expect(result.data.signup.message).toBe('This username is reserved')
  })

  // 6a. Invalid email format — defense in depth (Firebase usually catches this,
  //     but the GraphQL mutation is independent of Firebase).
  it('rejects email without @ with 400', async () => {
    const res = await executeAsUser(
      server,
      SIGNUP,
      { userInput: validInput({ email: 'aliceexample.com' }) },
      null,
    )
    const result = unwrap(res)
    expect(result.data.signup.code).toBe('400')
    expect(result.data.signup.message).toBe('Email format is invalid')
  })

  // 6b. Whitespace-only email.
  it('rejects whitespace-only email with 400', async () => {
    const res = await executeAsUser(
      server,
      SIGNUP,
      { userInput: validInput({ email: '   ' }) },
      null,
    )
    const result = unwrap(res)
    expect(result.data.signup.code).toBe('400')
    expect(result.data.signup.message).toBe('Email is required')
  })

  // 6c. Email with leading whitespace is trimmed and accepted (happy path).
  it('accepts email with surrounding whitespace (trimmed)', async () => {
    const res = await executeAsUser(
      server,
      SIGNUP,
      { userInput: validInput({ email: '  alice@example.com  ' }) },
      null,
    )
    const result = unwrap(res)
    expect(result.data.signup.code).toBe('200')
    expect(result.data.signup.success).toBe(true)
    expect(result.data.signup.user.email).toBe('alice@example.com')
  })

  // 7. Same username, exact same casing
  it('rejects duplicate userName (exact casing) with 409', async () => {
    const first = validInput({ userName: 'jfjobidon' })
    const r1 = await executeAsUser(server, SIGNUP, { userInput: first }, null)
    expect(unwrap(r1).data.signup.success).toBe(true)

    const second = validInput({ userName: 'jfjobidon' })
    const r2 = await executeAsUser(server, SIGNUP, { userInput: second }, null)
    const result = unwrap(r2)
    expect(result.data.signup.code).toBe('409')
    expect(result.data.signup.message).toBe('Username already taken')
  })

  // 8. Same username, different casing → blocked by userNameLower index
  it('rejects duplicate userName (different casing) with 409', async () => {
    const first = validInput({ userName: 'JFjobidon' })
    const r1 = await executeAsUser(server, SIGNUP, { userInput: first }, null)
    expect(unwrap(r1).data.signup.success).toBe(true)

    const second = validInput({ userName: 'jfjobidon' }) // different casing, same lowercase
    const r2 = await executeAsUser(server, SIGNUP, { userInput: second }, null)
    const result = unwrap(r2)
    expect(result.data.signup.code).toBe('409')
    expect(result.data.signup.message).toBe('Username already taken')
  })

  // 9. Same email, different casing
  it('rejects duplicate email (different casing) with 409', async () => {
    const first = validInput({ email: 'foo@osov.test' })
    const r1 = await executeAsUser(server, SIGNUP, { userInput: first }, null)
    expect(unwrap(r1).data.signup.success).toBe(true)

    const second = validInput({ email: 'FOO@osov.test' }) // different casing
    const r2 = await executeAsUser(server, SIGNUP, { userInput: second }, null)
    const result = unwrap(r2)
    expect(result.data.signup.code).toBe('409')
    expect(result.data.signup.message).toBe('Email already registered')
  })

  // 10. userInput null
  it('rejects null userInput with BAD_USER_INPUT GraphQL error', async () => {
    const res = await executeAsUser(server, SIGNUP, { userInput: null }, null)
    const result = unwrap(res)
    expect(result.errors).toBeDefined()
    expect(result.errors[0].extensions.code).toBe('BAD_USER_INPUT')
  })
})
