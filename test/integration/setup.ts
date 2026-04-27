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
  await prismaTest.user.create({ data: { email, userName, uid } })
  return { uid, email, userName }
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
