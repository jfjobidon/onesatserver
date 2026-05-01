// Integration test bootstrap.
//
// Builds the same Apollo server as src/index.ts but without the Express HTTP
// listener and without Firebase token verification. Tests inject context
// (`{ userId, isAuthenticated, ... }`) directly via executeOperation's
// contextValue, so the firebase.ts module is never imported here.
//
// IMPORTANT: this file imports Apollo / GraphQL / resolvers, which in turn
// import datasourcesmongo (Prisma) and datasourcesredis. Because vitest loads
// .env.test BEFORE these imports run (see vitest.config.ts `env:`), Prisma
// connects to the local Mongo Docker container (port 27018) instead of Atlas.
// Redis still connects to the dev container `osov-redis-dev` (port 6379)
// because the integration setup imports the production Redis bootstrap as-is.
// Fine for createCampaign which does not touch Redis. When addVote-level
// tests are added, they should switch to osov-redis-test (port 6380) via
// REDIS_URL from .env.test — requires datasourcesredis.ts to read REDIS_URL
// instead of hardcoding the connection.

import { ApolloServer } from '@apollo/server'
import { makeExecutableSchema } from '@graphql-tools/schema'
import { applyMiddleware } from 'graphql-middleware'
import { readFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'
import { createClient } from 'redis'

import resolvers from '../../src/resolvers/index.js'

export interface TestContext {
  userId?: string
  roles?: string[]
  isAuthenticated: boolean
  isAppToken?: boolean
}

const typeDefs = readFileSync('schema.graphql', { encoding: 'utf-8' })

let cachedServer: ApolloServer<TestContext> | null = null

/**
 * Returns a singleton ApolloServer wired to the test resolvers.
 * Cached because spinning up Apollo + Prisma + Redis on every test is wasteful
 * and would also re-create Redis indexes (slow, can flap).
 */
export async function getTestServer(): Promise<ApolloServer<TestContext>> {
  if (cachedServer) return cachedServer
  const schema = applyMiddleware(makeExecutableSchema({ typeDefs, resolvers }))
  const server = new ApolloServer<TestContext>({ schema })
  await server.start()
  cachedServer = server
  return server
}

/**
 * Singleton Prisma client pointing at the .env.test DATABASE_URL.
 * Used both by the resolvers (transitively, via datasourcesmongo's own
 * `new PrismaClient()`) and by tests for direct DB introspection / cleanup.
 */
export const prismaTest = new PrismaClient()

/**
 * Wipe collections that integration tests touch. Order matters: child rows
 * (Campaign references User.uid) before parents (User).
 */
export async function cleanupDatabase(): Promise<void> {
  await prismaTest.pollOption.deleteMany({})
  await prismaTest.poll.deleteMany({})
  await prismaTest.campaign.deleteMany({})
  await prismaTest.funding.deleteMany({})
  await prismaTest.user.deleteMany({})
}

let userCounter = 0
/** Insert a User and return its (auto-incremented) `uid`. */
export async function createTestUser(overrides: Partial<{ email: string; userName: string; uid: string }> = {}): Promise<{ uid: string; email: string; userName: string }> {
  userCounter += 1
  const email = overrides.email ?? `test-${userCounter}-${Date.now()}@osov.test`
  const userName = overrides.userName ?? `testuser-${userCounter}-${Date.now()}`
  const uid = overrides.uid ?? `test-uid-${userCounter}-${Date.now()}`
  // userNameLower mirrors the production signup flow: the Prisma model now requires
  // it as a @unique field for case-insensitive collision detection.
  await prismaTest.user.create({ data: { email, userName, userNameLower: userName.toLowerCase(), uid } })
  return { uid, email, userName }
}

/**
 * Insert a Campaign owned by `authorUid` and return the persisted document.
 * Defaults are wide-open (1..100 sats, all flags false, status="draft") so
 * polls created against it pass the inheritance checks unless the test
 * explicitly tightens the campaign via `overrides`.
 *
 * `authorUid` MUST belong to a User already inserted via createTestUser
 * (Prisma relation enforces it).
 */
export async function createTestCampaign(
  authorUid: string,
  overrides: Partial<{
    title: string
    description: string
    status: string
    minSatPerVote: number
    maxSatPerVote: number
    suggestedSatPerVote: number
    isPrivate: boolean
    blindAmount: boolean
    blindRank: boolean
    blindVote: boolean
    allowMultipleVotes: boolean
    paused: boolean
    startingDate: Date
    endingDate: Date
  }> = {},
): Promise<{ id: string; authorId: string; status: string }> {
  const now = new Date()
  const start = overrides.startingDate ?? new Date(now.getTime() + 24 * 60 * 60 * 1000) // +1d
  const end = overrides.endingDate ?? new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000) // +7d
  const created = await prismaTest.campaign.create({
    data: {
      authorId: authorUid,
      title: overrides.title ?? `Test Campaign ${Date.now()}`,
      description: overrides.description ?? 'Created by setup.ts:createTestCampaign',
      creationDate: now,
      updatedDate: now,
      startingDate: start,
      endingDate: end,
      minSatPerVote: overrides.minSatPerVote ?? 1,
      maxSatPerVote: overrides.maxSatPerVote ?? 100,
      suggestedSatPerVote: overrides.suggestedSatPerVote ?? 5,
      isPrivate: overrides.isPrivate ?? false,
      blindAmount: overrides.blindAmount ?? false,
      blindRank: overrides.blindRank ?? false,
      blindVote: overrides.blindVote ?? false,
      allowMultipleVotes: overrides.allowMultipleVotes ?? false,
      paused: overrides.paused ?? false,
      status: overrides.status ?? 'draft',
    },
  })
  return { id: created.id, authorId: created.authorId, status: created.status }
}

/**
 * Insert a Poll under `campaignId` owned by `authorUid` and return the persisted
 * document. Defaults inherit a permissive sat range (1..10) and all flags false
 * so options created against it pass the parent checks unless overridden.
 *
 * `authorUid` MUST be the campaign's authorId (mirrors the production rule:
 * only the campaign author can add a poll).
 */
export async function createTestPoll(
  campaignId: string,
  authorUid: string,
  overrides: Partial<{
    title: string
    description: string
    paused: boolean
    minSatPerVote: number
    maxSatPerVote: number
    suggestedSatPerVote: number
    blindAmount: boolean
    blindRank: boolean
    blindVote: boolean
    allowMultipleVotes: boolean
  }> = {},
): Promise<{ id: string; campaignId: string; authorId: string }> {
  const now = new Date()
  const title = overrides.title ?? `Test Poll ${Date.now()}-${Math.random()}`
  const created = await prismaTest.poll.create({
    data: {
      campaignId,
      authorId: authorUid,
      title,
      titleLower: title.toLowerCase(),
      description: overrides.description ?? 'Created by setup.ts:createTestPoll',
      paused: overrides.paused ?? false,
      creationDate: now,
      updatedDate: now,
      minSatPerVote: overrides.minSatPerVote ?? 1,
      maxSatPerVote: overrides.maxSatPerVote ?? 10,
      suggestedSatPerVote: overrides.suggestedSatPerVote ?? 5,
      blindAmount: overrides.blindAmount ?? false,
      blindRank: overrides.blindRank ?? false,
      blindVote: overrides.blindVote ?? false,
      allowMultipleVotes: overrides.allowMultipleVotes ?? false,
    },
  })
  return { id: created.id, campaignId: created.campaignId, authorId: created.authorId }
}

/**
 * Wrapper around server.executeOperation that injects an authenticated context.
 * Pass `null` to simulate an unauthenticated request.
 */
export async function executeAsUser(
  server: ApolloServer<TestContext>,
  query: string,
  variables: Record<string, unknown>,
  userId: string | null,
): Promise<any> {
  const contextValue: TestContext = userId
    ? { userId, isAuthenticated: true, roles: [], isAppToken: false }
    : { isAuthenticated: false }
  return server.executeOperation({ query, variables }, { contextValue })
}

/**
 * Extracts the data payload from a GraphQL response, asserting no top-level errors.
 * Apollo 4 wraps the response in `{ body: { kind, singleResult: { data, errors } } }`.
 */
export function unwrap(response: any): any {
  if (response.body?.kind !== 'single') {
    throw new Error(`Unexpected response kind: ${response.body?.kind}`)
  }
  return response.body.singleResult
}

/**
 * Insert a PollOption under `pollId` and return the persisted document.
 * Default title/description avoid collisions with the per-poll unique index.
 */
export async function createTestPollOption(
  pollId: string,
  overrides: Partial<{ title: string; description: string }> = {},
): Promise<{ id: string; pollId: string; title: string }> {
  const title = overrides.title ?? `Test Option ${Date.now()}-${Math.random()}`
  const created = await prismaTest.pollOption.create({
    data: {
      pollId,
      title,
      titleLower: title.toLowerCase(),
      description: overrides.description ?? 'Created by setup.ts:createTestPollOption',
    },
  })
  return { id: created.id, pollId: created.pollId, title: created.title }
}

/**
 * Singleton raw-Redis client for tests. Used to seed counters (`setUserSats`)
 * and wipe the test DB between tests (`cleanupRedis`). Different from the
 * redis-om client in `datasourcesredis.ts` so we can reach into the data
 * structures redis-om manages without going through its abstractions.
 *
 * Connects to `process.env.REDIS_URL` (provided by .env.test → port 6380).
 */
let cachedRedisClient: ReturnType<typeof createClient> | null = null
async function getRedisTestClient() {
  if (cachedRedisClient) return cachedRedisClient
  const url = process.env.REDIS_URL
  if (!url) throw new Error('REDIS_URL is not set in .env.test')
  cachedRedisClient = createClient({ url })
  cachedRedisClient.on('error', (err) => console.log('Redis test client error', err))
  await cachedRedisClient.connect()
  return cachedRedisClient
}

/**
 * Wipe Redis data keys (votes, counters, balances) without dropping the
 * RediSearch indexes that redis-om creates at startup. Using FLUSHDB would
 * also nuke the indexes — and since redis-om creates them only on the first
 * import of `datasourcesredis.ts`, FLUSHDB between tests breaks every
 * subsequent FT.SEARCH ("No such index satsUser:index").
 *
 * Strategy: scan and delete keys matching the schemas managed by
 * `datasourcesredis.ts`, leaving the index metadata intact.
 */
const REDIS_DATA_PATTERNS = [
  'vote:*',
  'satsPollOption:*',
  'votesPollOption:*',
  'viewsPollOption:*',
  'satsPoll:*',
  'votesPoll:*',
  'viewsPoll:*',
  'satsCampaign:*',
  'votesCampaign:*',
  'viewsCampaign:*',
  'satsUser:*',
  'userVoted:*',
  'activity:*',
]

export async function cleanupRedis(): Promise<void> {
  const client = await getRedisTestClient()
  for (const pattern of REDIS_DATA_PATTERNS) {
    let cursor = 0
    do {
      const reply = await client.scan(cursor, { MATCH: pattern, COUNT: 500 })
      cursor = reply.cursor
      if (reply.keys.length > 0) {
        await client.del(reply.keys)
      }
    } while (cursor !== 0)
  }
}

/**
 * Seed a user's sat balance directly (bypassing accountFunding).
 *
 * redis-om's `satsUser` schema stores the balance as a HASH at key
 * `satsUser:<entityId>` indexed by `uid`. Tests need a way to set the
 * balance without going through `accountFunding` (which has its own
 * validation we're not always testing). We write through redis-om's
 * convention so the `getSatsBalance` lookup picks it up.
 */
export async function setUserSats(uid: string, sats: number): Promise<void> {
  const client = await getRedisTestClient()
  // redis-om uses ULIDs as default entity keys. Easiest path: write a key
  // that satisfies the schema and is found by `search().where('uid')`.
  const entityId = `test-${uid}-${Date.now()}-${Math.random()}`
  await client.hSet(`satsUser:${entityId}`, { uid, sats: sats.toString() })
}

/**
 * Close the cached Redis test client. Call in `afterAll` to let the test
 * runner exit cleanly.
 */
export async function disconnectRedis(): Promise<void> {
  if (cachedRedisClient) {
    await cachedRedisClient.quit()
    cachedRedisClient = null
  }
}
