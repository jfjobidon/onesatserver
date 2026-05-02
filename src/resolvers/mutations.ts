
import {
  User,
  AddVoteMutationResponse,
  MutationResolvers,
  VoteInput,
  UserMutationResponse,
  CampaignMutationResponse,
  CampaignInput,
  UserInput,
  PollInput,
  PollOptionInput,
  PollMutationResponse,
  PollOptionMutationResponse,
  FundingMutationResponse,
  PauseMutationResponse,
  FavoriteElementMutationResponse,
  FavoriteInput,
} from '../__generated__/resolvers-types'

import { CreateNewsEventInput } from '../__generated__/resolvers-types'
import { GraphQLError } from 'graphql'
import { pubsub } from './pubsub.js'
import { DataSourcesRedis } from '../datasourcesredis.js'
const dataSourcesRedis = new DataSourcesRedis()
import { DataSourcesMongo } from '../datasourcesmongo.js'
const dataSourcesMongo = new DataSourcesMongo()
import { responseObject } from '../utils/types'
import { MAX_SATS_PER_VOTE_CEILING } from '../config/AppConfig.js'
import { isCampaignAcceptingVotes } from '../utils/campaignStatus.js'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

// check addVote authorisation for user
//    vérifier multiple votes...
// modifier la campagne tant qu'elle n'est pas lancée ?
// ajouter un filtre pour les subscriptions aux votes
    // le filtre sera fait sur les campaignId
    // tout les events seront envoyés aux clients
    // chaque client pourra mettre toutes les infos de la campagne à jour
    // et pourra décider d'envoyer une alerte à l'usager (en fonction du pollId ou pollOptionId par exemple)
    // c'est le client qui alertera aussi si une pollOption change de position
    // add subscription poll, pollOption, campaign pour chaque voteur
      // subscription campaign seulement coté serveur
      // le client fait les test pour subsrciption campaigne, poll, pollOption, etc...
    // add subscription : how much sats you make --> NON: coté client
// script simulation votes pour une campaign
// produire rapport votes de la campagne
// add users from excel file
// (cron job): campaignReport(campaignId)
// admin: getStats([campaignId | userId | pollId | pollOptionId])
// ? campaign: add field: numberVotes ?
// createPoll: check if title is unique: same for campaign, pollOption...

/**
 * Ordered, fail-fast validation for an addVote attempt.
 *
 * Caller passes the authenticated `uid` from `context.userId` — never trust the
 * client to tell us who is voting. Returns a `responseObject` whose `success`
 * field is `false` for any rejection; the caller is expected to short-circuit
 * before writing anything to Redis.
 *
 * This is Phase A (sécurité de base) — see documentation/addvote-audit.md and
 * documentation/acid-lua-redis.md. The cascade in `dataSourcesRedis.addVote`
 * is still NOT atomic; race conditions on double-vote and balance are
 * accepted for now and will be closed in Phase B via a Lua script.
 */
const validateVote = async (voteInput: VoteInput, uid: string): Promise<responseObject> => {
  // 1) Format — sats > 0, ids non-empty (the GraphQL `!` guarantees presence,
  //    but a string can still be empty; check defensively).
  if (!voteInput.campaignId || !voteInput.pollId || !voteInput.pollOptionId || !voteInput.invoice) {
    return { code: 400, success: false, message: "vote fields cannot be empty" }
  }
  if (!Number.isInteger(voteInput.sats) || voteInput.sats <= 0) {
    return { code: 400, success: false, message: "sats must be a positive integer" }
  }
  if (voteInput.sats > MAX_SATS_PER_VOTE_CEILING) {
    return {
      code: 400,
      success: false,
      message: `vote cannot exceed ${MAX_SATS_PER_VOTE_CEILING.toLocaleString()} sats (1 BTC)`,
    }
  }

  // 2) Balance — read the real Redis balance (no more 1111111 hardcode).
  const userSats = await dataSourcesRedis.getSatsBalance(uid)
  if (userSats < voteInput.sats) {
    return {
      code: 400,
      success: false,
      message: `Insufficient sats: you have ${userSats}, you need ${voteInput.sats}`,
    }
  }

  // 3) Parent campaign — must exist and currently accept votes.
  //    `isCampaignAcceptingVotes` is the single source of truth: it
  //    handles the fast path (status='active') and the slow path
  //    (status='published' inside [startingDate, endingDate], for the
  //    cron-not-yet-run window). See src/utils/campaignStatus.ts.
  //    Note: we use prisma.findUnique directly (not dataSourcesMongo.getCampaign)
  //    because the latter throws when not found instead of returning null.
  const campaign = await prisma.campaign.findUnique({ where: { id: voteInput.campaignId } })
  if (!campaign) {
    return { code: 404, success: false, message: "Campaign not found" }
  }
  const now = new Date()
  if (!isCampaignAcceptingVotes(campaign, now)) {
    // Disambiguate the rejection reason for a clearer UX message. The helper
    // returns a single bool for atomicity / single source of truth, but the
    // user wants to know WHY they can't vote.
    if (campaign.paused) {
      return { code: 409, success: false, message: "Campaign is paused" }
    }
    if (campaign.status === 'active' || campaign.status === 'published') {
      // Date out of window (started/ended). The slow path requires
      // both bounds; the fast path only checks the upper bound.
      if (now > new Date(campaign.endingDate)) {
        return { code: 409, success: false, message: "Campaign has ended" }
      }
      return { code: 409, success: false, message: "Campaign has not started yet" }
    }
    // draft / ready / ended / unknown
    const article = /^[aeiou]/i.test(campaign.status) ? 'an' : 'a'
    return {
      code: 409,
      success: false,
      message: `Cannot vote on ${article} ${campaign.status} campaign`,
    }
  }

  // 4) Sat range — campaign defines the bounds.
  if (voteInput.sats < campaign.minSatPerVote) {
    return {
      code: 400,
      success: false,
      message: `Vote should be at least ${campaign.minSatPerVote} sats`,
    }
  }
  if (voteInput.sats > campaign.maxSatPerVote) {
    return {
      code: 400,
      success: false,
      message: `Vote should be at most ${campaign.maxSatPerVote} sats`,
    }
  }

  // 5) Parent poll — must exist, belong to the campaign, not be paused.
  const poll = await prisma.poll.findUnique({ where: { id: voteInput.pollId } })
  if (!poll) {
    return { code: 404, success: false, message: "Poll not found" }
  }
  if (poll.campaignId !== voteInput.campaignId) {
    return { code: 400, success: false, message: "Poll does not belong to the given campaign" }
  }
  if (poll.paused) {
    return { code: 409, success: false, message: "Poll is paused" }
  }

  // 6) PollOption — must exist and belong to the poll.
  const pollOption = await prisma.pollOption.findUnique({ where: { id: voteInput.pollOptionId } })
  if (!pollOption) {
    return { code: 404, success: false, message: "Poll option not found" }
  }
  if (pollOption.pollId !== voteInput.pollId) {
    return { code: 400, success: false, message: "Poll option does not belong to the given poll" }
  }

  // 8) Double-vote — only when the poll forbids multiple votes.
  //    NOTE (Phase A): this read+write is non-atomic. Two parallel calls can
  //    both pass this check before either inserts, leading to a duplicate.
  //    Phase B will move this into the Lua script.
  if (poll.allowMultipleVotes === false) {
    const userVotesOnPoll = await dataSourcesRedis.getVotesForPoll(voteInput.pollId, uid)
    if (userVotesOnPoll.votes && userVotesOnPoll.votes.length > 0) {
      return { code: 409, success: false, message: "You have already voted on this poll" }
    }
  }

  return { code: 200, success: true, message: "vote is valid" }
}

// Use the generated `MutationResolvers` type to type check our mutations!
const mutations: MutationResolvers = {

  // createPoll: async (_, { pollInput }, context): Promise<PollMutationResponse> => {
    // signup: async (_, { userInput }): Promise<UserMutationResponse> => {
  favoriteElement: async (_, {favoriteInput}): Promise<FavoriteElementMutationResponse> => {
    // add/remove elementId in user.isfavorite
    // console.log("favoriteElement: ", favoriteInput.uid, favoriteInput.elementId, favoriteInput.isFavorite)
    // console.log("favoriteElement")
    if (!favoriteInput || !favoriteInput.uid || !favoriteInput.elementId || favoriteInput.isFavorite == null) {
      throw new GraphQLError('favoriteInput.uid, elementId and isFavorite are required', {
        extensions: { code: 'BAD_USER_INPUT', http: { status: 400 } },
      })
    }
    const favoriteResponse = await dataSourcesMongo.favoriteElement({
      uid: favoriteInput.uid,
      elementId: favoriteInput.elementId,
      isFavorite: favoriteInput.isFavorite,
    })
    return favoriteResponse
    // return {
    //   code: favoriteResponse.code,
    //   success: favoriteResponse.success,
    //   message: favoriteResponse.message,
    //   isFavorite: favoriteResponse.isFavorite
    // }
    // return {
    //   code: "400",
    //   success: true,
    //   message: "ok",
    //   isFavorite: true
    // }
  },

  createNewsEvent: (_parent: any, args: CreateNewsEventInput) => {
    console.log('args:', args)
    pubsub.publish('EVENT_CREATED', { newsFeed: args })
    return args
  },

  signup: async (_, { userInput }): Promise<UserMutationResponse> => {
    console.log("mutation signup....")
    if (!userInput || !userInput.email || !userInput.uid || !userInput.userName) {
      throw new GraphQLError('userInput.email, uid and userName are required', {
        extensions: { code: 'BAD_USER_INPUT', http: { status: 400 } },
      })
    }
    const userMutationResponse = await dataSourcesMongo.signup({
      email: userInput.email,
      uid: userInput.uid,
      userName: userInput.userName,
    })
    return {
      code: userMutationResponse.code,
      success: userMutationResponse.success,
      message: userMutationResponse.message,
      user: userMutationResponse.user
    }
  },

  /**
   * ## accountFunding — server resolver (Phase 1 dev)
   *
   * Recharges the authenticated user's sat balance. The voter is **always**
   * `context.userId` — the input no longer carries `userId`.
   *
   * Datasource enforces: `invoice @unique` (409 on dup), positive sats (400),
   * existing user (404). A Mongo `Funding` row is created and the Redis
   * `satsUser[uid]` counter is incremented.
   *
   * Phase 2 will replace this with a Lightning Network invoice verification.
   */
  accountFunding: async (_, { fundingInput }, context): Promise<FundingMutationResponse> => {
    if (!context.userId) {
      throw new GraphQLError('Not authenticated', {
        extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } },
      })
    }
    if (!fundingInput) {
      throw new GraphQLError('fundingInput is required', {
        extensions: { code: 'BAD_USER_INPUT', http: { status: 400 } },
      })
    }
    return await dataSourcesMongo.accountFunding(context.userId, fundingInput)
  },

  /**
   * ## createCampaign — server resolver
   *
   * Creates a new campaign owned by the authenticated user.
   *
   * ### Authentication & identity
   * - Requires a valid Firebase Bearer token (verified in `src/firebase.ts` via the Apollo `context`).
   * - The author is **always** taken from `context.userId` (uid extracted from the verified token).
   *   Any `authorId` field sent by the client is ignored — the GraphQL schema doesn't even accept it.
   *
   * ### Errors
   * - `UNAUTHENTICATED` (401) if no/invalid token.
   * - `BAD_USER_INPUT` (400) if `campaignInput` is missing.
   * - The datasource may also return a structured response with `success: false` for validation errors
   *   (title length, sat bounds, date order, etc.) — those don't throw.
   *
   * ### Side effects
   * - Inserts a new document in MongoDB (`Campaign` collection via Prisma).
   * - No Redis writes happen here (Redis stats are populated when votes start coming in).
   *
   * ### Related files
   * - Datasource: `src/datasourcesmongo.ts` → `DataSourcesMongo.createCampaign(input, authorId)`
   * - Schema: `schema.graphql` → `input CampaignInput` and `mutation createCampaign`
   * - Client call: `onesatclient/screens/CreateCampaignScreens/CreateCampaignScreen.tsx`
   */
  createCampaign: async (_, { campaignInput }, context): Promise<CampaignMutationResponse> => {
    if (!context.userId) {
      throw new GraphQLError('Not authenticated', {
        extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } },
      })
    }
    if (!campaignInput) {
      throw new GraphQLError('campaignInput is required', {
        extensions: { code: 'BAD_USER_INPUT', http: { status: 400 } },
      })
    }
    let campaign = await dataSourcesMongo.createCampaign(campaignInput, context.userId)
    return {...campaign}
  },

  publishCampaign: async (_, { campaignId }, context): Promise<CampaignMutationResponse> => {
    let result = await dataSourcesMongo.publishCampaign(campaignId)
    return {...result}
  },

  /**
   * ## createPoll — server resolver
   *
   * Creates a new poll inside an existing campaign. Requires the caller to
   * be the campaign's author. The datasource enforces all business rules:
   * parent campaign exists, status is draft/ready, sat bounds inherit from
   * the campaign, privacy flags can only strengthen (not relax), and the
   * poll title is unique (case-insensitive) within the campaign.
   *
   * See `documentation/specs-for-client/createPoll.spec.md` for the full
   * client-facing contract.
   */
  createPoll: async (_, { pollInput }, context): Promise<PollMutationResponse> => {
    if (!context.userId) {
      throw new GraphQLError('Not authenticated', {
        extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } },
      })
    }
    if (!pollInput) {
      throw new GraphQLError('pollInput is required', {
        extensions: { code: 'BAD_USER_INPUT', http: { status: 400 } },
      })
    }
    return await dataSourcesMongo.createPoll(pollInput, context.userId)
  },

  createPollOption: async (_, { pollOptionInput }, context): Promise<PollOptionMutationResponse> => {
    if (!context.userId) {
      throw new GraphQLError('Not authenticated', {
        extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } },
      })
    }
    if (!pollOptionInput) {
      throw new GraphQLError('pollOptionInput is required', {
        extensions: { code: 'BAD_USER_INPUT', http: { status: 400 } },
      })
    }
    return await dataSourcesMongo.createPollOption(pollOptionInput, context.userId)
  },

  togglePausePoll: async (_, { pausePollInput }, context): Promise<PauseMutationResponse> => {
    console.log("toggle pause poll")
    console.log(context)
    if (!pausePollInput) {
      throw new GraphQLError('pausePollInput is required', {
        extensions: { code: 'BAD_USER_INPUT', http: { status: 400 } },
      })
    }
    let campaignStatus = await dataSourcesMongo.togglePausePoll(pausePollInput)
    console.log("togglePausePoll return: ", campaignStatus)
    return campaignStatus
  },

  togglePauseCampaign: async (_, { pauseCampaignInput }, context): Promise<PauseMutationResponse> => {
    console.log("toggle pause campaign")
    console.log(context)
    if (!pauseCampaignInput) {
      throw new GraphQLError('pauseCampaignInput is required', {
        extensions: { code: 'BAD_USER_INPUT', http: { status: 400 } },
      })
    }
    let campaignStatus = await dataSourcesMongo.togglePauseCampaign(pauseCampaignInput)
    console.log("togglePauseCampaign return: ", campaignStatus)
    return campaignStatus
  },

  /**
   * ## addVote — server resolver (Phase A — sécurité de base)
   *
   * Records a vote for the authenticated user on a (campaign, poll, pollOption)
   * triplet. The voter's identity is **always** taken from `context.userId` —
   * `VoteInput` no longer carries `uid` / `userName`.
   *
   * ### What's hardened in Phase A
   * - Auth check via Firebase token (`context.userId` required).
   * - `validateVote` reads the real Redis balance (no more `1111111` hardcode).
   * - Campaign status must be `published` or `active` to accept votes.
   * - Voter's balance is decremented inside the Redis cascade.
   *
   * ### Known Phase A limitation
   * The Redis cascade (`addVote` in datasourcesredis) is still non-atomic —
   * a server crash mid-cascade leaves desynchronised counters. Two parallel
   * votes from the same user on a `!allowMultipleVotes` poll can both pass
   * the duplicate check. Phase B closes both holes via a Lua script.
   * See `documentation/acid-lua-redis.md`.
   */
  addVote: async (_, { voteInput }, context): Promise<AddVoteMutationResponse> => {
    if (!context.userId) {
      throw new GraphQLError('Not authenticated', {
        extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } },
      })
    }
    if (!voteInput) {
      throw new GraphQLError('voteInput is required', {
        extensions: { code: 'BAD_USER_INPUT', http: { status: 400 } },
      })
    }
    const validation = await validateVote(voteInput, context.userId)
    if (!validation.success) {
      return {
        code: validation.code,
        success: false,
        message: validation.message,
        vote: null,
      }
    }
    const voteResponse = await dataSourcesRedis.addVote(voteInput, context.userId)
    if (voteResponse.success) {
      pubsub.publish('EVENT_VOTEADDED', { voteAdded: voteResponse.vote })
    }
    return voteResponse
  }
}

export default mutations