# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OneSatOneVote (OSOV) is a Bitcoin-powered voting platform backend. Users create campaigns containing polls with poll options, and votes are cast using satoshis (sats). The server is a GraphQL API built with Apollo Server, Express, Prisma (MongoDB), and Redis.

## Common Commands

- **Dev (watch mode):** `npm run watch` — runs codegen, TypeScript compiler, and nodemon concurrently
- **Build & start:** `npm start` — compiles then runs `node ./dist/index.js`
- **Compile only:** `npm run compile` — runs GraphQL codegen then `tsc`
- **Full rebuild:** `npm run pgc` — runs Prisma generate, GraphQL codegen, then TypeScript compile
- **GraphQL codegen:** `npm run generate` — regenerates `src/__generated__/resolvers-types.ts` from `schema.graphql`
- **Prisma generate:** `npm run prisma` — regenerates Prisma client from `prisma/schema.prisma`

After modifying `schema.graphql`, run `npm run generate` to regenerate types. After modifying `prisma/schema.prisma`, run `npm run prisma`.

## Architecture

### Dual-database design
- **MongoDB** (via Prisma): stores persistent entities — Users, Campaigns, Polls, PollOptions, Fundings
- **Redis** (via redis-om): stores transactional/aggregate data — Votes, sats/votes/views counters per entity, user voted-campaign lists, activity logs

### Key source files
- `src/index.ts` — Express + Apollo Server + WebSocket setup, custom DateScalar
- `src/datasourcesmongo.ts` (`DataSourcesMongo` class) — all Prisma/MongoDB operations
- `src/datasourcesredis.ts` (`DataSourcesRedis` class) — all Redis operations (votes, counters, activity)
- `src/schema.redis.ts` — Redis OM schema definitions (HASH data structures)
- `src/resolvers/` — GraphQL resolvers split into queries, mutations, subscriptions
- `src/permissions.ts` — graphql-shield permission rules (currently all pass-through)
- `schema.graphql` — the GraphQL schema (root level, not in src/)
- `prisma/schema.prisma` — Prisma schema for MongoDB
- `config/` — node-config JSON files (`default.json`, `production.json`)

### Data flow pattern
Resolvers instantiate `DataSourcesMongo` and `DataSourcesRedis` at module level. MongoDB holds the entity records; Redis holds vote details and aggregated stats (sats, votes, views). When fetching campaigns/polls/pollOptions, the Mongo datasource internally calls Redis to attach stats. Vote mutations go to Redis, which cascades counter increments up through pollOption -> poll -> campaign -> user.

### Revenue split logic
When votes are cast, sats are split between the campaign author and OSOV: author gets `floor(totalSats/2) + 1`, OSOV gets the remainder. This is in `DataSourcesRedis.incrCampaign()`.

### GraphQL subscriptions
WebSocket-based subscriptions (`voteAdded`, `newsFeed`) use `graphql-ws` over the same HTTP server. PubSub events are published in mutations.

### Type generation
`schema.graphql` → `codegen.yml` → `src/__generated__/resolvers-types.ts`. The generated types are used throughout resolvers and datasource classes. Prisma also generates its own types (`Campaign as CampaignMongo`, etc.) which are aliased on import to avoid conflicts with GraphQL types.

## Configuration

Environment-specific config via `node-config` in `config/`. The `NODE_ENV` environment variable selects the config file. Default config values for campaign settings (minSatPerVote, blindAmount, paused, etc.) come from here.
