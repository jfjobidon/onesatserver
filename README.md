# OneSatOneVote Server

A Bitcoin-powered voting platform backend where votes are weighted by satoshis (sats). Users create campaigns containing polls with options, and votes are cast with associated sat amounts. Built with GraphQL, Apollo Server, Express, Prisma (MongoDB), and Redis.

## Getting Started

### Prerequisites
- Node.js v22+
- Docker (for Redis)
- MongoDB Atlas account (or local MongoDB)

### Installation

```bash
npm install
npm run pgc    # generates Prisma client + GraphQL types + compiles TypeScript
```

### Development

```bash
npm run watch
```

Runs three concurrent processes:
- **CodeGen** — watches `src/**/*.ts` and regenerates GraphQL types
- **TS** — TypeScript compiler in watch mode
- **Nodemon** — auto-restarts server when `dist/` changes

### Build & Start

```bash
npm start          # compile + start server
npm run compile    # GraphQL codegen + tsc only
npm run pgc        # Prisma generate + codegen + tsc (full rebuild)
npm run generate   # GraphQL codegen only
npm run prisma     # Prisma client generation only
```

After modifying `schema.graphql`, run `npm run generate`. After modifying `prisma/schema.prisma`, run `npm run prisma`.

## Redis Setup (Docker)

This project uses **redis/redis-stack** (includes RedisJSON and RediSearch, required by redis-om).

### Create container with persistent volume

```bash
docker run -d \
  --name osov-redis \
  -p 6379:6379 \
  -v osov-redis-data:/data \
  -e REDIS_ARGS="--requirepass rRTGwNDL7a --save 60 1" \
  redis/redis-stack:latest
```

**Important:** Use `-e REDIS_ARGS` instead of passing `redis-server ...` as a command. Overriding the command disables the Stack modules (RediSearch, RedisJSON) that redis-om requires for `FT.*` commands.

- **`-p 6379:6379`** — maps container port to localhost:6379 (what the app expects)
- **`-v osov-redis-data:/data`** — named volume that persists data across container restarts and recreates
- **`--requirepass rRTGwNDL7a`** — sets the password to match the app config
- **`--save 60 1`** — snapshot to disk every 60 seconds if at least 1 key changed. Without this, Redis only saves on graceful shutdown; a crash would lose all data since the last save

### Common Docker commands

```bash
docker start osov-redis          # start
docker stop osov-redis           # stop
docker logs osov-redis           # check logs
```

### Update Redis image

```bash
docker stop osov-redis
docker rm osov-redis
docker pull redis/redis-stack:latest
docker run -d \
  --name osov-redis \
  -p 6379:6379 \
  -v osov-redis-data:/data \
  -e REDIS_ARGS="--requirepass rRTGwNDL7a --save 60 1" \
  redis/redis-stack:latest
```

The named volume `osov-redis-data` survives the container removal, so data is preserved.

### Connect with redis-cli

```bash
docker exec -it osov-redis redis-cli -a rRTGwNDL7a
```

## Architecture

### Dual-Database Design

```
Client (GraphQL)
    |
Apollo Server (Express + WebSocket)
    |
GraphQL Resolvers (queries, mutations, subscriptions)
    |
    +---> DataSourcesMongo (Prisma/MongoDB)  -- persistent entities
    +---> DataSourcesRedis (redis-om/Redis)  -- votes, counters, activity
```

- **MongoDB** (via Prisma): Users, Campaigns, Polls, PollOptions, Fundings
- **Redis** (via redis-om): Vote records, sats/votes/views counters per entity, user voted-campaign lists, activity logs

### Data Flow

When fetching campaigns/polls/pollOptions, entity data comes from MongoDB and is enriched with real-time stats (sats, votes, views) from Redis before returning to the client. Polls and options are sorted by sats descending.

### Vote Flow

1. Client calls `addVote` mutation with `VoteInput`
2. Validation checks: user balance, sat amount limits, campaign/poll pause state, date range
3. Vote record saved to Redis with a unique `voteCode`
4. Counters incremented at three levels: PollOption -> Poll -> Campaign
5. User's voted campaigns list updated
6. Revenue split: campaign author gets `floor(sats/2) + 1`, platform gets the rest
7. PubSub publishes `EVENT_VOTEADDED` for WebSocket subscribers

### Configuration

Uses `node-config` package with JSON files in `config/`:
- `config/default.json` — development (port 40000, MongoDB Atlas)
- `config/production.json` — production (port 4001, local MongoDB)

`NODE_ENV` selects the config file.

## GraphQL API

Server runs on port 40000 (dev) / 4001 (production). WebSocket subscriptions on root path `/`.

### Queries

| Query | Parameters | Returns | Description |
|-------|-----------|---------|-------------|
| `ping` | — | `{ pong: "Pong" }` | Health check |
| `getLocalIpAddress` | — | `String` | Server's local IPv4 |
| `getUsers` | — | `[User]` | All users |
| `getUserById` | `id: String!` | `User` | User by MongoDB ID |
| `getUserByEmail` | `email: String!` | `User` | User by email |
| `getUserByUserName` | `userName: String!` | `User` | User by username |
| `getUserName` | `uid: String!` | `User` | User by Firebase UID |
| `getCampaign` | `id: String!` | `Campaign` | Single campaign with stats |
| `getCampaignAll` | `id: String!` | `CampaignAll` | Campaign with all polls and options |
| `getCampaigns` | `uid: String, campaignType: CampaignType` | `[Campaign]` | Filtered campaigns |
| `getCampaignsVoted` | `uid: String!` | `[String]` | Campaign IDs user voted on |
| `getPoll` | `id: String!` | `Poll` | Single poll with stats |
| `getPollsForCampaign` | `campaignId: String!` | `[Poll]` | All polls for a campaign |
| `getPollOption` | `id: String!` | `PollOption` | Option with vote history |
| `getPollOptionsForPoll` | `pollId: String!` | `[PollOption]` | All options for a poll |
| `getVotesForCampaign` | `campaignId: String!, uid: String` | `getVotesQueryResponse` | Campaign votes |
| `getUserVotesForCampaign` | `campaignId: String!, uid: String` | `getVotesQueryResponse` | User's votes in campaign |
| `getVotesForPoll` | `pollId: String!, uid: String` | `getVotesQueryResponse` | Poll votes |
| `getVotesForPollOption` | `pollOptionId: String!` | `getVotesQueryResponse` | Option votes |
| `getVotesForUser` | `uid: String!` | `getVotesQueryResponse` | All votes by user |
| `getVoteById` | `id: String!` | `Vote` | Single vote |
| `getFavorites` | `uid: String!` | `[String]` | User's favorited element IDs |
| `getVoted` | `uid: String!` | `[String]` | Campaign IDs user voted on |

**CampaignType enum:** `USER`, `FAVORITES`, `VOTED`, `ALL`

### Mutations

| Mutation | Input | Returns | Description |
|----------|-------|---------|-------------|
| `signup` | `UserInput` | `UserMutationResponse` | Create user account |
| `createCampaign` | `CampaignInput` | `CampaignMutationResponse` | Create campaign |
| `createPoll` | `PollInput` | `PollMutationResponse` | Create poll in campaign |
| `createPollOption` | `PollOptionInput` | `PollOptionMutationResponse` | Create option in poll |
| `addVote` | `VoteInput` | `AddVoteMutationResponse` | Cast a vote with sats |
| `favoriteElement` | `FavoriteInput` | `favoriteElementMutationResponse` | Toggle favorite |
| `accountFunding` | `FundingInput` | `FundingMutationResponse` | Fund user account |
| `togglePauseCampaign` | `PauseCampaignInput` | `pauseMutationResponse` | Pause/resume campaign |
| `togglePausePoll` | `PausePollInput` | `pauseMutationResponse` | Pause/resume poll |
| `createNewsEvent` | `title: String!, description: String!` | `NewsEvent` | Publish news event |

**Mutation responses** follow the pattern: `{ code, success, message, ...data }`

### Subscriptions (WebSocket)

| Subscription | Parameters | Description |
|-------------|-----------|-------------|
| `voteAdded` | `campaignId: String!` | Real-time vote updates for a campaign |
| `newsFeed` | — | News event stream |

### Input Types

**UserInput:** `email, userName, uid`

**CampaignInput:** `title, description, authorId, startingDate, endingDate, minSatPerVote, maxSatPerVote, suggestedSatPerVote, isPrivate, blindAmount, blindRank, blindVote, allowMultipleVotes`

**PollInput:** `campaignId, authorId, title, description, minSatPerVote, maxSatPerVote, suggestedSatPerVote, blindAmount, blindRank, blindVote, allowMultipleVotes`

**PollOptionInput:** `pollId, title, description`

**VoteInput:** `uid, userName, invoice, sats, campaignId, pollId, pollOptionId, certified`

**FavoriteInput:** `uid, elementId, isFavorite`

**FundingInput:** `userId, sats, invoice`

## Data Models

### MongoDB (Prisma)

**User** — `id, email, userName, uid (Firebase), roles[], favorites[], creationDate, updatedDate, lastLogin`
- Relations: campaigns[], fundings[], polls[]

**Campaign** — `id, authorId, title, description, message, creationDate, startingDate, endingDate, updatedDate`
- Voting config: `minSatPerVote, maxSatPerVote, suggestedSatPerVote`
- Flags: `isPrivate, blindAmount, blindRank, blindVote, allowMultipleVotes, paused`
- Relations: author (User), polls[]

**Poll** — `id, campaignId, authorId, title, description, paused, creationDate, updatedDate`
- Inherits voting config and flags from campaign input
- Relations: campaign, author (User), pollOptions[]

**PollOption** — `id, pollId, title, description`
- Stats (sats, votes, views) stored in Redis

**Funding** — `id, date, invoice, sats, authorId`

### Redis (redis-om)

All schemas use HASH data structure:

| Schema | Key Fields | Purpose |
|--------|-----------|---------|
| `voteSchema` | uid, voteCode, invoice, sats, campaignId, pollId, pollOptionId, certified, date | Individual vote records |
| `satsCampaignSchema` | campaignId, sats | Total sats per campaign |
| `satsPollSchema` | pollId, sats | Total sats per poll |
| `satsPollOptionSchema` | pollOptionId, sats | Total sats per option |
| `votesCampaign/Poll/PollOptionSchema` | entityId, votes | Vote count per entity |
| `viewsCampaign/Poll/PollOptionSchema` | entityId, views | View count per entity |
| `satsUserSchema` | uid, sats | User's earned sats |
| `userVotedSchema` | uid, campaignIds[] | Campaigns user voted in |
| `activitySchema` | type, uid, description, date | Activity logs |

## Project Structure

```
onesatserver/
  config/              # Environment-specific JSON configs
  prisma/
    schema.prisma      # MongoDB data model
  src/
    __generated__/     # Auto-generated GraphQL types (do not edit)
    resolvers/
      index.ts         # Root resolver exports
      queries.ts       # Query resolvers
      mutations.ts     # Mutation resolvers + vote validation
      subscriptions.ts # WebSocket subscription resolvers
      pubsub.ts        # PubSub instance
      scalarTypes.ts   # DateScalar definition
    utils/
      types.ts         # Role enum, responseObject type
    datasourcesmongo.ts # MongoDB/Prisma operations
    datasourcesredis.ts # Redis operations (votes, counters, activity)
    index.ts           # Server entry point (Express + Apollo + WS)
    permissions.ts     # graphql-shield rules
    schema.redis.ts    # Redis OM schema definitions
  schema.graphql       # GraphQL schema (source of truth)
  codegen.yml          # GraphQL code generator config
```
