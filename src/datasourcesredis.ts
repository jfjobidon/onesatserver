import { createClient } from 'redis'
import { Repository, EntityId, EntityKeyName, Entity } from 'redis-om'

// Connection string lives in REDIS_URL (loaded from .env via dotenv in src/index.ts).
// Format: redis://default:<password>@localhost:6379  (or rediss:// for TLS in prod).
// The password is NEVER in code — it's per-environment and gitignored.
const redisUrl = process.env.REDIS_URL
if (!redisUrl) {
  throw new Error('REDIS_URL is not set. Add it to .env (see README "Redis Setup").')
}
const redisClient = createClient({ url: redisUrl })
redisClient.on('error', (err) => console.log('Redis Client Error', err))
await redisClient.connect()
const aString = await redisClient.ping()
console.log('redis PING: ', aString)
import { OSOV_USER_ID } from './config/AppConfig.js'

import randomstring from "randomstring"

import { Vote, VoteInput, AddVoteMutationResponse, GetVotesQueryResponse } from "./__generated__/resolvers-types"
import { userVotedSchema, voteSchema, satsPollOptionSchema, votesPollOptionSchema, viewsPollOptionSchema, satsPollSchema, votesPollSchema, viewsPollSchema, satsCampaignSchema, votesCampaignSchema, viewsCampaignSchema, satsUserSchema, activitySchema } from './schema.redis.js'

let voteRepository = new Repository(voteSchema, redisClient)
// await voteRepository.dropIndex()
await voteRepository.createIndex()  // required to use search (RediSearch)

let satsPollOptionRepository = new Repository(satsPollOptionSchema, redisClient)
await satsPollOptionRepository.createIndex()

let activitiesRepository = new Repository(activitySchema, redisClient)
await activitiesRepository.createIndex()

let votesPollOptionRepository = new Repository(votesPollOptionSchema, redisClient)
await votesPollOptionRepository.createIndex()

let viewsPollOptionRepository = new Repository(viewsPollOptionSchema, redisClient)
await viewsPollOptionRepository.createIndex()

let satsPollRepository = new Repository(satsPollSchema, redisClient)
await satsPollRepository.createIndex()

let votesPollRepository = new Repository(votesPollSchema, redisClient)
await votesPollRepository.createIndex()

let viewsPollRepository = new Repository(viewsPollSchema, redisClient)
await viewsPollRepository.createIndex()

let satsCampaignRepository = new Repository(satsCampaignSchema, redisClient)
await satsCampaignRepository.createIndex()

let votesCampaignRepository = new Repository(votesCampaignSchema, redisClient)
await votesCampaignRepository.createIndex()

let userVotedRepository = new Repository(userVotedSchema, redisClient)
await userVotedRepository.createIndex()

let viewsCampaignRepository = new Repository(viewsCampaignSchema, redisClient)
await viewsCampaignRepository.createIndex()

let satsUserRepository = new Repository(satsUserSchema, redisClient)
await satsUserRepository.createIndex()

export class DataSourcesRedis {
  /**
   * Persist a vote in Redis and update all derived counters.
   *
   * Phase A (sécurité de base) — see documentation/acid-lua-redis.md.
   * The cascade below is **NOT atomic**: if the process dies mid-way,
   * counters end up desynchronised. Phase B replaces the whole sequence
   * with a Lua script. The voter's `userName` is fetched from Mongo at
   * call time (no longer trusted from the client).
   *
   * The voter's balance is decremented here via `incrUser(uid, -sats)`.
   * The campaign-author + OSOV credit happens inside `incrCampaign`.
   */
  async addVote(voteInput: VoteInput, uid: string): Promise<AddVoteMutationResponse> {
    const voteCode = randomstring.generate(12)
    const currentDate = new Date()

    // Resolve userName + campaign author from Mongo (server-derived — never
    // trust the client). The campaign author is the recipient of the sat split;
    // the voter is `uid`. We use Prisma directly instead of the Mongo
    // datasource methods because those throw on not-found rather than return
    // null, and we want graceful error responses here.
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient()
    const user = await prisma.user.findUnique({ where: { uid } })
    if (!user) {
      return { code: 404, success: false, message: "Voter not found", vote: null }
    }
    const campaign = await prisma.campaign.findUnique({ where: { id: voteInput.campaignId } })
    if (!campaign) {
      return { code: 404, success: false, message: "Campaign not found", vote: null }
    }

    const voteData = {
      uid,
      userName: user.userName,
      invoice: voteInput.invoice,
      sats: voteInput.sats,
      campaignId: voteInput.campaignId,
      pollId: voteInput.pollId,
      pollOptionId: voteInput.pollOptionId,
      certified: voteInput.certified,
      voteCode,
      date: currentDate.toString(),
    }

    const vote: Entity = await voteRepository.save(voteData)
    const entityKey = vote[EntityKeyName]
    if (!entityKey) {
      return { code: 500, success: false, message: "Vote saved but no entity key returned by Redis", vote: null }
    }
    const exists = await redisClient.exists(entityKey)
    if (!exists) {
      return { code: 500, success: false, message: "Problem adding new vote!", vote: null }
    }

    // Cascade: decrement voter balance, increment all aggregates, mark voted.
    // `incrCampaign` also credits the campaign author + OSOV (sat split).
    await this.incrUser(uid, -voteInput.sats)
    await this.incrPollOption(voteInput.pollOptionId, voteInput.sats)
    await this.incrPoll(voteInput.pollId, voteInput.sats)
    await this.incrCampaign(voteInput.campaignId, campaign.authorId, voteInput.sats)
    await this.addUserVoted(uid, voteInput.campaignId)

    return {
      code: 200,
      success: true,
      message: "New vote added!",
      vote: Object(vote),
    }
  }

  // type: { type: 'string' },  // 1: createCamapign, 2: createPoll, 3: createPollOption, 4: startCampaign, 5: endCampaign, 6: archiveCampaign, 7: pauseCampaign, 8: resumeCampaign, 9: approvisionner, 10: retirer
  // uid: { type: 'string' },
  // description: { type: 'string' },
  // date: { type: 'string' }
  // TODO: cronjob to show all the votes, views and sats for the day, favorites, etc.
  // create user
  // user login
  // authenticate email
  // create campaing
  // create poll
  // create pollOption
  // start campaing (owner + favorites)
  // end campaing (owner + favorites)
  // archive campaing (owner)
  // pause campaing (owner)
  // resume campaing (owner)
  // favorite campaing
  // unfavorite campaing
  // vote by user
  // win sats ??!!??  // TODO: deactivate verbose: no logs
  // approvisionner compte en sats
  // retirer sats
  async logActivity(uid: string, description: string): Promise<void> {
    const activity: Entity = await activitiesRepository.save({ type: "log", uid: uid,  description: description, date: new Date().toString() })
    console.log(activity)
  }

  async incrPollOption(pollOptionId: string, sats: number): Promise<Boolean> {
    try {
      // increments sats for PollOption
      // console.log("pollOptionId", pollOptionId)
      const satsPollOption: Entity[] = await satsPollOptionRepository.search().where('pollOptionId').equals(pollOptionId).return.all()
      // console.log(satsPollOption)
      if (satsPollOption.length == 0) {
        // console.log("satsPollOption empty")
        const pollOption2: Entity = await satsPollOptionRepository.save({ "pollOptionId": pollOptionId, sats: sats })
        // console.log(pollOption2)
      } else {
        satsPollOption[0].sats = (sats + parseInt(satsPollOption[0].sats!.toString()))
        satsPollOptionRepository.save(satsPollOption[0])
      }
      // increments votes for PollOption
      const votesPollOption: Entity[] = await votesPollOptionRepository.search().where('pollOptionId').equals(pollOptionId).return.all()
      // console.log(votesPollOption)
      if (votesPollOption.length == 0) {
        // console.log("votesPollOption empty")
        const votesPollOption2: Entity = await votesPollOptionRepository.save({ "pollOptionId": pollOptionId, votes: 1 })
        // console.log(votesPollOption2)
      } else {
        votesPollOption[0].votes = (1 + parseInt(votesPollOption[0].votes!.toString()))
        votesPollOptionRepository.save(votesPollOption[0])
      }
      // TODO: remove this: just for debugging now
      // increments views for PollOption
      // REVIEW: remplacer par INCRBY pollOptionId 1
      const viewsPollOption: Entity[] = await viewsPollOptionRepository.search().where('pollOptionId').equals(pollOptionId).return.all()
      // console.log("viewsPollOption", viewsPollOption)
      if (viewsPollOption.length == 0) {
        // console.log("viewsPollOption empty")
        const viewsPollOption2: Entity = await viewsPollOptionRepository.save({ "pollOptionId": pollOptionId, views: 1 })
        // console.log(viewsPollOption2)
      } else {
        viewsPollOption[0].views = (1 + parseInt(viewsPollOption[0].views!.toString()))
        viewsPollOptionRepository.save(viewsPollOption[0])
      }
    } catch (err) {
      console.error(err)
      return false
    }
    return true
  }
    // REVIEW: other way to do it:
    // let pollOption0 = pollOption2[0]
    // let entityId = pollOption0[EntityId]
    // const pollop = await satsPollOptionRepository.fetch(entityId)
    // pollop.sats = (sats + parseInt(pollop.sats.toString()))
    // satsPollOptionRepository.save(pollop)

  async incrPoll(pollId: string, sats: number): Promise<Boolean> {
    try {
      // console.log(pollId)
      // increment sat for Poll
      const satsPoll: Entity[] = await satsPollRepository.search().where('pollId').equals(pollId).return.all()
      // console.log(satsPoll)
      if (satsPoll.length == 0) {
        // console.log("poll empty")
        const poll2: Entity = await satsPollRepository.save({ "pollId": pollId, sats: sats })
        // console.log(poll2)
      } else {
        satsPoll[0].sats = (sats + parseInt(satsPoll[0].sats!.toString()))
        satsPollRepository.save(satsPoll[0])
      }

      // increment votes for Poll
      const votesPoll: Entity[] = await votesPollRepository.search().where('pollId').equals(pollId).return.all()
      // console.log(votesPoll)
      if (votesPoll.length == 0) {
        // console.log("poll empty")
        const votesPoll2: Entity = await votesPollRepository.save({ "pollId": pollId, votes: 1 })
        // console.log(votesPoll2)
      } else {
        votesPoll[0].votes = (1 + parseInt(votesPoll[0].votes!.toString()))
        votesPollRepository.save(votesPoll[0])
      }

      // increments views for Poll
      const viewsPoll: Entity[] = await viewsPollRepository.search().where('pollId').equals(pollId).return.all()
      // console.log("viewsPoll", viewsPoll)
      if (viewsPoll.length == 0) {
        // console.log("viewsPoll empty")
        const viewsPoll2: Entity = await viewsPollRepository.save({ "pollId": pollId, views: 1 })
        // console.log(viewsPoll2)
      } else {
        viewsPoll[0].views = (1 + parseInt(viewsPoll[0].views!.toString()))
        viewsPollRepository.save(viewsPoll[0])
      }
    } catch (err) {
      console.error(err)
      return false
    }
    return true
  }

  async getSatsForCampaign(campaignId: string): Promise<number> {
    const satCampaign: Entity[] = await satsCampaignRepository.search().where('campaignId').equals(campaignId).return.all()
    let sats: number = 0
    if (satCampaign.length == 0) {
      sats = 0
    } else {
      sats = parseInt((satCampaign[0].sats!).toString())
    }
    return sats
  }

  async getSatsForPoll(pollId: string): Promise<number> {
    const satsPoll: Entity[] = await satsPollRepository.search().where('pollId').equals(pollId).return.all()
    let sats: number = 0
    if (satsPoll.length == 0) {
      sats = 0
    } else {
      sats = parseInt((satsPoll[0].sats!).toString())
    }
    return sats
  }

  async getSatsBalance(uid: string): Promise<number> {
    const satsUser: Entity[] = await satsUserRepository.search().where('uid').equals(uid).return.all()
    if (satsUser.length == 0) return 0
    return parseInt((satsUser[0].sats!).toString())
  }

  async getNbVotesForCampaign(campaignId: string): Promise<number> {
    const voteCampaign: Entity[] = await votesCampaignRepository.search().where('campaignId').equals(campaignId).return.all()
    let nbVotes: number
    if (voteCampaign.length == 0) {
      nbVotes = 0
    } else {
      nbVotes = parseInt((voteCampaign[0].votes!).toString())
    }
    return nbVotes
  }

  async getNbVotesForPoll(pollId: string): Promise<number> {
    const votePoll: Entity[] = await votesPollRepository.search().where('pollId').equals(pollId).return.all()
    let nbVotes: number
    // console.log("votePollOBJ", votePoll)
    if (votePoll.length == 0) {
      nbVotes = 0
    } else {
      nbVotes = parseInt((votePoll[0].votes!).toString())
    }
    return nbVotes
  }

  async getNbViewsForPoll(pollId: string): Promise<number> {
    // console.log("pollId", pollId)
    const viewsPoll: Entity[] = await viewsPollRepository.search().where('pollId').equals(pollId).return.all()
    let views: number
    if (viewsPoll.length == 0) {
      views = 0
    } else {
      views = parseInt((viewsPoll[0].views!).toString())
    }
    return views
  }

  async getNbViewsForCampaign(campaignId: string): Promise<number> {
    const viewsCampaign: Entity[] = await viewsCampaignRepository.search().where('campaignId').equals(campaignId).return.all()
    let nbViews: number
    if (viewsCampaign.length == 0) {
      nbViews = 0
    } else {
      nbViews = parseInt((viewsCampaign[0].views!).toString())
    }
    return nbViews
  }

  // https://jsdoc.app/tags-type
  /**
   * retreive all campaignIds for which the user has voted
   * @param {string} uid - id of the current user
   * @returns {[string]} - array of campaign ids
  */
  async getVoted(uid: string): Promise<string[]> {
    // const exists = await redisClient.exists('userVoted:01JCHC08V5WGZ5X633XP1H64Y3')
    //   console.log("exists: ", exists)
    // const x = await userVotedRepository.fetch('01JCHC08V5WGZ5X633XP1H64Y3')
    // console.log("entityId", x)
    const userVoted: Entity[] = await userVotedRepository.search().where('uid').equals(uid).return.all()
    // console.log("getVoted userVoted", userVoted)
    // console.log("userVoted['entityId']", userVoted['entityId'])
    if (userVoted.length === 0 ) {
      // console.log("userVoted.length", userVoted.length)
      // console.log("userVoted.uid", userVoted)
      // console.log( "campaignId", JSON.parse(JSON.stringify(userVoted[0].campaignId)))
      // console.log("Symbol(entityId)", userVoted['Symbol(EntityId)'])
      // console.log("getVoted EntityKeyName", userVoted[EntityKeyName])
      return []
    } else {
      // console.log("getVoted userVoted[0].campaignIds", JSON.parse(JSON.stringify(userVoted[0].campaignIds)))
      return JSON.parse(JSON.stringify(userVoted[0].campaignIds))
    }
  }
 
  async addUserVoted(uid: string, campaignId: string): Promise<Boolean> {
    try {
      const userVoted: Entity[] = await userVotedRepository.search().where('uid').equals(uid).return.all()
      // console.log("addUserVoted userVoted", userVoted)
      // console.log("addUserVoted userVoted lenght", userVoted.length)
      // console.log("userVoted", userVoted)
      if (userVoted.length === 0) {
        userVoted[0] = {
          uid: uid,
          campaignIds: [campaignId]
        }
        await userVotedRepository.save(userVoted[0])
      } else if (userVoted.length === 1) {
        console.log("addUserVoted", userVoted)
        let campaignIds: string[] = JSON.parse(JSON.stringify(userVoted[0].campaignIds))
        if (!campaignIds.includes(campaignId)) {
          // console.log("add campaignId")
          // console.log("campaignIds", campaignIds)
          campaignIds.push(campaignId)
          userVoted[0].campaignIds = campaignIds
          await userVotedRepository.save(userVoted[0])
        } else {
          // console.log("campaign Id is included")
        }
      }
    } catch(error) {
      console.log("addUserVoted ERROR", error)
      return false
    }
    return true
  }

  /**
   * Increment campaign aggregates and credit the campaign author + OSOV.
   *
   * The sat split is `floor(totalSats/2) + 1` to the author, the rest to OSOV.
   * Because the +1 tiebreak depends on the running total, the per-vote delta
   * is computed as `after - before` (not just `floor(sats/2) + 1`), keeping
   * the running invariant `authorBalance + osovBalance = campaignTotal`.
   *
   * `authorId` is the **campaign author's** uid — not the voter's. Earlier
   * code passed the voter's uid here, which was a silent bug (voters were
   * crediting themselves).
   */
  async incrCampaign(campaignId: string, authorId: string, sats: number): Promise<Boolean> {
    try {
      const satsCampaign: Entity[] = await satsCampaignRepository.search().where('campaignId').equals(campaignId).return.all()
      let satsUser: number  // sats credited to the campaign author
      let satsOSOV: number  // sats credited to the OSOV platform account
      if (satsCampaign.length == 0) {
        satsUser = Math.floor(sats / 2) + 1
        satsOSOV = sats - satsUser
        this.incrUser(authorId, satsUser)
        this.incrUser(OSOV_USER_ID, satsOSOV)
        await satsCampaignRepository.save({ "campaignId": campaignId, sats: sats })
      } else {
        let beforeSatsCampaign = parseInt(satsCampaign[0].sats!.toString())
        const beforeSatsUser = Math.floor(beforeSatsCampaign / 2) + 1
        const beforeSatsOSOV = beforeSatsCampaign - beforeSatsUser
        const afterSatsCampaign = beforeSatsCampaign + sats
        const afterSatsUser = Math.floor(afterSatsCampaign / 2) + 1
        const afterSatsOSOV = afterSatsCampaign - afterSatsUser
        this.incrUser(authorId, afterSatsUser - beforeSatsUser)
        this.incrUser(OSOV_USER_ID, afterSatsOSOV - beforeSatsOSOV)

        satsCampaign[0].sats = (sats + beforeSatsCampaign)
        satsCampaignRepository.save(satsCampaign[0])
      }

      // increments votes for Campaign
      const votesCampaign: Entity[] = await votesCampaignRepository.search().where('campaignId').equals(campaignId).return.all()
      // console.log(votesCampaign)
      if (votesCampaign.length == 0) {
        // console.log("campaign empty")
        const votesCampaign2: Entity = await votesCampaignRepository.save({ "campaignId": campaignId, votes: 1 })
        // console.log(votesCampaign2)
      } else {
        votesCampaign[0].votes = (1 + parseInt(votesCampaign[0].votes!.toString()))
        votesCampaignRepository.save(votesCampaign[0])
      }

      // increments views for Campaign
      const viewsCampaign: Entity[] = await viewsCampaignRepository.search().where('campaignId').equals(campaignId).return.all()
      // console.log("viewsCampaign", viewsCampaign)
      if (viewsCampaign.length == 0) {
        // console.log("viewsCampaign empty")
        const viewsCampaign2: Entity = await viewsCampaignRepository.save({ "campaignId": campaignId, views: 1 })
        // console.log(viewsCampaign2)
      } else {
        viewsCampaign[0].views = (1 + parseInt(viewsCampaign[0].views!.toString()))
        viewsCampaignRepository.save(viewsCampaign[0])
      }

    } catch (err) {
      console.error(err)
    }
    return true
  }


  async incrUser(uid: string, sats: number): Promise<Boolean> {
    try {
      // console.log(userId)
      // increments sats for User
      const satsUser: Entity[] = await satsUserRepository.search().where('uid').equals(uid).return.all()
      // console.log(satsUser)
      if (satsUser.length == 0) {
        // console.log("user empty")
        const satsUser2: Entity = await satsUserRepository.save({ "uid": uid, sats: sats })
        // console.log(satsUser2)
      } else {
        satsUser[0].sats = (sats + parseInt(satsUser[0].sats!.toString()))
        satsUserRepository.save(satsUser[0])
      }
    } catch (err) {
      console.error(err)
    }
    return true
  }

  async getVotesForCampaign(campaignId: string, uid: string): Promise<GetVotesQueryResponse> {
    // console.log("in getVotesForCampaign...")

    // const votesNb: number = await voteRepository.search().return.count()
    // console.log(`Number of votes: ${votesNb}`)

    let allVotes: Entity[]

    if (uid === null) {
      allVotes = await voteRepository.search()
        // .where('date').matches('date01')  // type must be 'text'
        .where('campaignId').equals(campaignId)
        // .and('title').matches('butterfly')
        // .and('year').is.greaterThan(2000)
        .return.all()
    } else {
      allVotes = await voteRepository.search()
        .where('campaignId').equals(campaignId)
        .and('uid').equals(uid)
        .return.all()
    }

    // console.table(allVotes)
    // console.log('getVotesForCampaign entity: ' + allVotes[EntityId])

    let votesResponse: Vote[] = allVotes.map(x => Object(x)) // convert [Entity] to [Vote]  // REVIEW: send [Entity]
    // https://github.com/redis/redis-om-node/blob/main/README.md
    return { votes: votesResponse }
  }

  async getUserVotesForCampaign(campaignId: string, uid: string): Promise<GetVotesQueryResponse> {
    let allVotes: Entity[]
    allVotes = await voteRepository.search()
      .where('campaignId').equals(campaignId)
      .and('uid').equals(uid)
      .return.all()
    let votesResponse: Vote[] = allVotes.map(x => Object(x))
    return { votes: votesResponse }
  }

  async getVotesForPoll(pollId: string, uid: string): Promise<GetVotesQueryResponse> {

    let allVotes: Entity[]

    if (uid === null) {
      allVotes = await voteRepository.search()
        .where('pollId').equals(pollId)
        .return.all()
    } else {
      allVotes = await voteRepository.search()
        .where('pollId').equals(pollId)
        .and('uid').equals(uid)
        .return.all()
    }
    let votesResponse: Vote[] = allVotes.map(x => Object(x))
    return { votes: votesResponse }
  }

  async getVotesForPollOption(pollOptionId: string): Promise<GetVotesQueryResponse> {
  let allVotes: Entity[]
    allVotes = await voteRepository.search()
      .where('pollOptionId').equals(pollOptionId)
      .return.all()

    let votesResponse: Vote[] = allVotes.map(x => Object(x))
    return { votes: votesResponse }
  }

  
  async getSatsForPollOption(pollOptionId: string): Promise<number> {
    const satsPollOption: Entity[] = await satsPollOptionRepository.search().where('pollOptionId').equals(pollOptionId).return.all()
    let sats: number = 0
    if (satsPollOption.length == 0) {
      sats = 0
    } else {
      sats = parseInt((satsPollOption[0].sats!).toString())
    }
    return sats
  }

  async getNbVotesForPollOption(pollOptionId: string): Promise<number> {
    const nbVotesPollOption: Entity[] = await votesPollOptionRepository.search().where('pollOptionId').equals(pollOptionId).return.all()
    let nbVotes: number
    if (nbVotesPollOption.length == 0) {
      nbVotes = 0
    } else {
      nbVotes = parseInt((nbVotesPollOption[0].votes!).toString())
    }
    return nbVotes
  }


  async getNbViewsForPollOption(pollOptionId: string): Promise<number> {
    // console.log("pollOptionId", pollOptionId)
    const viewsPollOption: Entity[] = await viewsPollOptionRepository.search().where('pollOptionId').equals(pollOptionId).return.all()
    let views: number
    if (viewsPollOption.length == 0) {
      views = 0
    } else {
      views = parseInt((viewsPollOption[0].views!).toString())
    }
    return views
  }

  async getVotesForUser(uid: string): Promise<GetVotesQueryResponse> {
    const allVotes = await voteRepository.search()
      .where('uid').equals(uid)
      .return.all()
    let votesResponse: Vote[] = allVotes.map(x => Object(x))
    return { votes: votesResponse }
  }

  async getVoteById(voteId: string): Promise<Vote | null> {
    const exists = await redisClient.exists(`vote:${voteId}`)
    if (exists) {
      let vote = await voteRepository.fetch(voteId)
      return Object(vote)
    } else {
      return null
    }
  }
}