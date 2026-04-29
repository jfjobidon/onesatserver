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

## MongoDB Setup (Docker)

This project uses **mongo:7** with a **single-node replica set**. Prisma + MongoDB requires a replica set for transactions (used by nested writes in `createCampaign` etc.) — a standalone Mongo will fail at runtime.

### Why two volumes per container

The `mongo` image declares two volumes in its Dockerfile:
- `/data/db` — actual database files (collections, indexes)
- `/data/configdb` — replica set configuration / metadata

Both must be mapped to **named** volumes; otherwise Docker creates anonymous volumes (visible as a hash in Portainer) for `/data/configdb`. We use the convention `<container-name>-data` for `/data/db` and `<container-name>-configdb-data` for `/data/configdb`.

### Create the dev container (with auth)

The dev container enforces auth — any connection (Compass, Prisma, mongosh) must provide credentials. Username and password live in `.env` (gitignored) as part of `DATABASE_URL`. **Never** put real credentials in `config/*.json` (those files are versioned).

**Important :** Mongo refuses `--auth` together with `--replSet` unless a `--keyFile` is provided (it's the shared secret between replica-set members for internal authentication, even with a single member). So we must:
1. Generate a random keyFile and store it in `.docker-secrets/` (gitignored).
2. Mount it read-only into the container at `/etc/mongo-keyfile`.
3. Run the container with the `mongodb` user (uid 999) so it can read the keyFile.

```bash
# 1. Generate the keyFile (one-time setup; persists across container recreates).
mkdir -p .docker-secrets
openssl rand -base64 756 > .docker-secrets/mongo-keyfile
chmod 400 .docker-secrets/mongo-keyfile

# 2. Replace the values below with your own. They MUST match .env's DATABASE_URL.
export MONGO_USERNAME=osovAdmin
export MONGO_PASSWORD='<your-password>'  # generate with: openssl rand -hex 24
                                          # (use -hex, not -base64, so the password is safe to embed
                                          #  in DATABASE_URL without %-encoding the / + = chars)

# 3. Run the container.
docker run -d \
  --name osov-mongo-dev \
  -p 27017:27017 \
  -v osov-mongo-dev-data:/data/db \
  -v osov-mongo-dev-configdb-data:/data/configdb \
  -v "$(pwd)/.docker-secrets/mongo-keyfile:/etc/mongo-keyfile:ro" \
  -e MONGO_INITDB_ROOT_USERNAME="$MONGO_USERNAME" \
  -e MONGO_INITDB_ROOT_PASSWORD="$MONGO_PASSWORD" \
  --user 999:999 \
  mongo:7 --replSet rs0 --bind_ip_all --auth --keyFile /etc/mongo-keyfile
```

**Then create the admin user and init the replica set.**

If `/data/db` was empty (fresh volume), `MONGO_INITDB_ROOT_USERNAME/PASSWORD` automatically creates the admin user on first start. But if you reused an existing volume (the common case when re-creating the container), Mongo skips that step and you must create the user manually via the **localhost exception** (Mongo allows one unauthenticated localhost connection when no users exist yet):

```bash
sleep 5  # let Mongo finish booting

# Create the admin user (skip this if you started with a fresh volume).
docker exec osov-mongo-dev mongosh --quiet admin --eval '
db.createUser({
  user: "'"$MONGO_USERNAME"'",
  pwd: "'"$MONGO_PASSWORD"'",
  roles: [ { role: "root", db: "admin" } ]
})'

# Init the replica set (skip if rs0 already exists from a previous setup).
docker exec osov-mongo-dev mongosh \
  -u "$MONGO_USERNAME" -p "$MONGO_PASSWORD" --authenticationDatabase admin \
  --quiet --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]})"
```

- **`--auth`** — enforces authentication. Without it, anyone can connect anonymously.
- **`--keyFile`** — internal cluster authentication (mandatory with `--replSet` + `--auth`).
- **`--user 999:999`** — runs Mongo as the `mongodb` user (uid 999 inside the container), required because it must read the keyFile.
- **`MONGO_INITDB_ROOT_*`** — only effective on a *fresh* `/data/db` volume.
- **`--bind_ip_all`** — allows connections from the host (default is loopback only inside the container).
- **`?authSource=admin`** in the connection string is required because the admin user lives in the `admin` database, not in `onesatonevote`.

The matching `.env` entry:
```env
DATABASE_URL="mongodb://osovAdmin:<your-password>@localhost:27017/onesatonevote?replicaSet=rs0&directConnection=true&authSource=admin"
```

### Create the test container

Same image and replica set, but on port **27018** with separate volumes so the integration test suite (`vitest --project integration`) wipes its DB without touching dev data:

```bash
docker run -d \
  --name osov-mongo-test \
  -p 27018:27017 \
  -v osov-mongo-test-data:/data/db \
  -v osov-mongo-test-configdb-data:/data/configdb \
  mongo:7 --replSet rs0 --bind_ip_all

sleep 3
docker exec osov-mongo-test mongosh --quiet --eval \
  "rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]})"
```

### Common Docker commands

```bash
docker start osov-mongo-dev      # start
docker stop osov-mongo-dev       # stop
docker logs osov-mongo-dev       # check logs
docker exec -it osov-mongo-dev mongosh    # open a shell
```

### Verify replica set

```bash
# dev (with auth)
docker exec osov-mongo-dev mongosh \
  -u "$MONGO_USERNAME" -p "$MONGO_PASSWORD" --authenticationDatabase admin \
  --quiet --eval "rs.status().myState"
# Should print: 1   (1 = PRIMARY)

# test (no auth)
docker exec osov-mongo-test mongosh --quiet --eval "rs.status().myState"
```

### Connection strings

The connection URL must include `replicaSet=rs0&directConnection=true`. `directConnection=true` skips the SRV resolution that's only meant for Atlas.

| Container | Connection string |
|---|---|
| `osov-mongo-dev` | `mongodb://USER:PASS@localhost:27017/onesatonevote?replicaSet=rs0&directConnection=true&authSource=admin` (in `.env` as `DATABASE_URL`, USER/PASS from your local setup) |
| `osov-mongo-test` | `mongodb://localhost:27018/osov_test?replicaSet=rs0&directConnection=true` (in `.env.test` as `DATABASE_URL`, no auth on test instance) |

## Redis Setup (Docker)

This project uses **redis/redis-stack** (includes RedisJSON and RediSearch, required by redis-om).

### Create container with persistent volume

```bash
# Replace with your own password — generate with: openssl rand -hex 24
# (use -hex so the password is safe to embed in REDIS_URL without %-encoding).
# It MUST match the password embedded in REDIS_URL inside .env.
export REDIS_PASSWORD='<your-password>'

docker run -d \
  --name osov-redis-dev \
  -p 6379:6379 \
  -v osov-redis-dev-data:/data \
  -e REDIS_ARGS="--requirepass $REDIS_PASSWORD --save 60 1" \
  redis/redis-stack:latest
```

**Important:** Use `-e REDIS_ARGS` instead of passing `redis-server ...` as a command. Overriding the command disables the Stack modules (RediSearch, RedisJSON) that redis-om requires for `FT.*` commands.

- **`-p 6379:6379`** — maps container port to localhost:6379 (what the app expects)
- **`-v osov-redis-dev-data:/data`** — named volume that persists data across container restarts and recreates
- **`--requirepass $REDIS_PASSWORD`** — sets the password (sourced from your local env, never committed)
- **`--save 60 1`** — snapshot to disk every 60 seconds if at least 1 key changed. Without this, Redis only saves on graceful shutdown; a crash would lose all data since the last save

The matching `.env` entry:
```env
REDIS_URL="redis://default:<your-password>@localhost:6379"
```

There is also a **test** instance for the integration test suite:

```bash
docker run -d \
  --name osov-redis-test \
  -p 6380:6379 \
  -v osov-redis-test-data:/data \
  -e REDIS_ARGS="--requirepass $REDIS_PASSWORD --save 60 1" \
  redis/redis-stack:latest
```

Same image, same password, but separate volume and exposed on port **6380** so it doesn't clash with `osov-redis-dev`.

### Common Docker commands

```bash
docker start osov-redis-dev      # start
docker stop osov-redis-dev       # stop
docker logs osov-redis-dev       # check logs
```

### Update Redis image

```bash
docker stop osov-redis-dev
docker rm osov-redis-dev
docker pull redis/redis-stack:latest
docker run -d \
  --name osov-redis-dev \
  -p 6379:6379 \
  -v osov-redis-dev-data:/data \
  -e REDIS_ARGS="--requirepass $REDIS_PASSWORD --save 60 1" \
  redis/redis-stack:latest
```

The named volume `osov-redis-dev-data` survives the container removal, so data is preserved.

### Connect with redis-cli

```bash
docker exec -it osov-redis-dev redis-cli -a "$REDIS_PASSWORD"
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

Uses `node-config` package with JSON files in `config/`. `node-config` merges `default.json` with the env-specific file (`<NODE_ENV>.json` or `<NODE_CONFIG_ENV>.json`) — env-specific values override defaults.

#### Environments

| Env | Selector | Mongo | Redis | Config file |
|---|---|---|---|---|
| **development** | `NODE_ENV` unset or `development` (default) | `osov-mongo-dev` Docker (port 27017) | `osov-redis-dev` Docker (port 6379) | `config/default.json` |
| **test** | `NODE_ENV=test` (auto-set by vitest) | `osov-mongo-test` Docker (port 27018) | `osov-redis-test` Docker (port 6380) | `config/test.json` (merges over default) |
| **staging** | `NODE_CONFIG_ENV=staging` | Atlas staging (TBD) | Redis Cloud staging (TBD) | `config/staging.json` (placeholder values) |
| **production** | `NODE_ENV=production` | Atlas prod | Redis Cloud prod (TBD) | `config/production.json` |

**Note on staging vs production:**
- `NODE_ENV=production` is reserved by convention (Express, bundlers activate optimizations only on this exact value). Staging keeps `NODE_ENV=production` for the same optimizations and uses **`NODE_CONFIG_ENV=staging`** to load `config/staging.json` instead of `config/production.json`. Optionally also set `APP_ENV=staging` if app code needs to branch on the env name.
- `node-config` documentation: setting `NODE_CONFIG_ENV` overrides `NODE_ENV` for config selection only — they can differ on purpose.

#### `DBURI` (config/*.json) vs `DATABASE_URL` (.env) — keep in sync

Two parallel mechanisms read the same DB connection string:
- **`DATABASE_URL`** in `.env` — consumed by Prisma directly via `prisma/schema.prisma`. **This is the source of truth at runtime.**
- **`DBURI`** in `config/*.json` — read via `node-config` for any tool / script / future code path that prefers config-file lookup.

**Rule:** when you change one, change the other in the same commit. They must always point at the same database for the active environment. There is currently no automated check — it's a discipline.

The default dev DB is the **local Docker container `osov-mongo-dev`**, not Atlas. Atlas is reserved for production and staging (when provisioned).

#### Quick environment commands

```bash
# Development (default)
npm run watch

# Test (vitest sets NODE_ENV=test automatically and loads .env.test)
npm test

# Production simulation locally (won't actually start unless Atlas is reachable)
NODE_ENV=production node ./dist/index.js

# Staging simulation
NODE_CONFIG_ENV=staging NODE_ENV=production node ./dist/index.js
```

#### Backlog (config cleanup)

- `config/default.json` and `config/production.json` are tracked in git with the Atlas password and RSA keys in cleartext. These secrets need to be rotated and moved to `.env` / `.env.production` (gitignored).
- `PRIVATE_KEY` / `PUBLIC_KEY` in `config/default.json` are no longer read by any code (`grep` confirms). To be removed in a follow-up pass.
- `config/staging.json` contains `TODO` placeholders — fill in once the staging cloud infra (Atlas + Redis Cloud) is provisioned.


### Shared client/server constants & validation rules

Some constants must be **identical** on both sides of the wire. They live in two mirrored files and are documented as such:
- [`onesatserver/src/config/AppConfig.ts`](src/config/AppConfig.ts)
- [`onesatclient/config/AppConfig.ts`](../onesatclient/config/AppConfig.ts)

When you change a value on one side, update the other in the **same commit**. Same rule for any new shared constant.

**Security rule — never trust the client.** Any constraint enforced client-side (sat bounds, length limits, date order, status transitions, …) must be re-validated server-side. A user with Postman / curl / a custom client can submit anything that satisfies the GraphQL schema; the schema only checks types and `!`-required fields. Business invariants are the resolver's responsibility.

**Workflow for new client-side validations.** When the client team adds or changes a validation rule, they must mirror the rule on the server. To keep both sides in sync without back-and-forth, the client documents what they expect the server to enforce in:

```
onesatclient/docs/specs-for-server.md
```

That file is the single source of truth for client → server validation requests. The user (project owner) tells the server team when a new spec lands; the server team then reads that file and applies the matching validations in the appropriate resolver/datasource/AppConfig. **Do not invent validations**: only implement what is explicitly listed there or what the server already needs to be safe against malicious payloads (the server is always free to be stricter than the client, never laxer).

Current shared constraints (validators present on both sides):

| Constraint | Constant | Server validator | Client validator |
|---|---|---|---|
| Sats per vote — min floor | `MIN_SATS_PER_VOTE_FLOOR = 1` | [`utils/satsBounds.ts`](src/utils/satsBounds.ts) `validateSatsMin` | `onesatclient/utils/satsBounds.ts` |
| Sats per vote — max ceiling | `MAX_SATS_PER_VOTE_CEILING = 100_000_000` | [`utils/satsBounds.ts`](src/utils/satsBounds.ts) `validateSatsMax` | `onesatclient/utils/satsBounds.ts` |
| Title max length | `MAX_TITLE_LENGTH = 100` | `validateTitle` (datasource) | react-hook-form `maxLength` |
| Description max length | `MAX_DESCRIPTION_LENGTH = 1000` | `validateDescription` (datasource) | react-hook-form `maxLength` |
| Starting date ≥ now (with grace) | `STARTING_DATE_GRACE_MS = 60_000` | [`utils/dateBounds.ts`](src/utils/dateBounds.ts) `validateCampaignDates` | inline in `CreateCampaignScreen` |
| Starting date ≤ now + 6 months | `MAX_CAMPAIGN_START_AHEAD_MS = 182 * 24 * 60 * 60 * 1000` | [`utils/dateBounds.ts`](src/utils/dateBounds.ts) `validateCampaignDates` | inline in `CreateCampaignScreen` |
| Campaign duration ≤ 1 year | `MAX_CAMPAIGN_DURATION_MS = 365 * 24 * 60 * 60 * 1000` | [`utils/dateBounds.ts`](src/utils/dateBounds.ts) `validateCampaignDates` | inline in `CreateCampaignScreen` |
| End date > start date | — | [`utils/dateBounds.ts`](src/utils/dateBounds.ts) `validateCampaignDates` | form check |
| Campaign duration ≥ 5 minutes | `MIN_CAMPAIGN_DURATION_MS = 5 * 60 * 1000` | [`utils/dateBounds.ts`](src/utils/dateBounds.ts) `validateCampaignDates` | inline in `CreateCampaignScreen` |
| `min ≤ suggested ≤ max` sats | — | `createCampaign` | form check |
| Username min length | `MIN_USERNAME_LENGTH = 3` | [`utils/userBounds.ts`](src/utils/userBounds.ts) `validateUsername` | mirror in `onesatclient/utils/userBounds.ts` |
| Username max length | `MAX_USERNAME_LENGTH = 30` | [`utils/userBounds.ts`](src/utils/userBounds.ts) `validateUsername` | idem |
| Username charset (alphanumeric + `_` `-`) | `USERNAME_CHARSET_REGEX` | [`utils/userBounds.ts`](src/utils/userBounds.ts) `validateUsername` | idem |
| Reserved usernames (case-insensitive) | `RESERVED_USERNAMES` | [`utils/userBounds.ts`](src/utils/userBounds.ts) `validateUsername` | idem |
| Username uniqueness (case-insensitive) | — | Prisma `@unique` on `userNameLower` (lowercased copy) | form pre-check + UX for `409 'Username already taken'` |
| Email max length | `MAX_EMAIL_LENGTH = 254` (RFC 5321) | [`utils/emailBounds.ts`](src/utils/emailBounds.ts) `validateEmail` | mirror in `onesatclient/utils/emailBounds.ts` |
| Email format | `EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/` | [`utils/emailBounds.ts`](src/utils/emailBounds.ts) `validateEmail` | idem |
| Email uniqueness (case-insensitive) | — | Prisma `@unique` on lowercased `email` | UX for `409 'Email already registered'` |
| Poll author = campaign author | — | `createPoll` datasource: `campaign.authorId === context.userId` | hide "Add poll" button for non-authors |
| Poll allowed only on draft / ready campaign | — | `createPoll` datasource: status check before insert | hide "Add poll" button when campaign status ∉ {draft, ready} |
| Poll sat bounds inherit from campaign | — | `createPoll` datasource: `campaign.min ≤ poll.min ≤ poll.max ≤ campaign.max` | pre-validate using campaign's min/max in scope |
| Poll privacy flags can strengthen, not relax | — | `createPoll` datasource: if `campaign.blindX` → poll must be `true`; if `!campaign.allowMultipleVotes` → poll must be `false` | disable the relevant Switch when campaign forces it |
| Poll title uniqueness (case-insensitive, per-campaign) | — | Prisma composite `@@unique([campaignId, titleLower])` | UX for `409 'A poll with this title already exists in this campaign'` |
| Poll option title min/max length | `MAX_TITLE_LENGTH = 100` (reused) | [`utils/textBounds.ts`](src/utils/textBounds.ts) `validateTitle` | mirror in client |
| Poll option description min/max length | `MAX_DESCRIPTION_LENGTH = 1000` (reused) | [`utils/textBounds.ts`](src/utils/textBounds.ts) `validateDescription` | mirror in client |
| Poll option author = campaign author | — | `createPollOption` datasource: `poll.campaign.authorId === context.userId` | hide "Add option" button for non-authors |
| Poll option allowed only on draft / ready campaign | — | `createPollOption` datasource: status check before insert | hide "Add option" button when campaign status ∉ {draft, ready} |
| Poll option title uniqueness (case-insensitive, per-poll) | — | Prisma composite `@@unique([pollId, titleLower])` | UX for `409 'An option with this title already exists in this poll'` |

`CampaignStatus` values (`draft / ready / published / scheduled / active / paused / ended`) are also shared — the client exports them as a constant, the server currently uses string literals. Keep both vocabularies in sync.

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
